import json
import hashlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import publisher_state as ps
import upload_youtube as uy
import fetch


def _write_item(root: Path, term_id="alpha", title="알파", duration=12.4):
    video_dir = root / "video_v2"
    video_dir.mkdir(parents=True, exist_ok=True)
    (video_dir / f"{term_id}.mp4").write_bytes(b"fake-mp4-payload")
    (video_dir / f"{term_id}.json").write_text(
        json.dumps({
            "id": term_id,
            "term_ko": title,
            "term_en": "Alpha",
            "category": "behavioral",
            "definition": "definition",
            "duration": duration,
            "toc": [],
        }, ensure_ascii=False),
        encoding="utf-8",
    )
    return video_dir


class StateStoreTests(unittest.TestCase):
    def test_corrupt_state_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.json"
            path.write_text("{broken", encoding="utf-8")
            with self.assertRaises(ps.PublicationStateError):
                ps.load_state(path)

    def test_future_state_schema_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.json"
            path.write_text(
                json.dumps({ps.META_KEY: {"schema_version": 999}}),
                encoding="utf-8",
            )
            with self.assertRaises(ps.PublicationStateError):
                ps.load_state(path)

    def test_legacy_video_id_is_not_treated_as_fully_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.json"
            path.write_text(
                json.dumps({"alpha": {"video_id": "vid-1", "uploaded_at": "old"}}),
                encoding="utf-8",
            )
            state = ps.load_state(path)
            self.assertEqual(state["alpha"]["video_id"], "vid-1")
            self.assertEqual(state["alpha"]["phase"], "uploaded_unknown")
            self.assertEqual(state[ps.META_KEY]["schema_version"], 2)

    def test_atomic_save_keeps_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.json"
            ps.save_state_atomic(path, {ps.META_KEY: {"schema_version": 2}, "v": 1})
            ps.save_state_atomic(path, {ps.META_KEY: {"schema_version": 2}, "v": 2})
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["v"], 2)
            backup = path.with_name(path.name + ".bak")
            self.assertEqual(json.loads(backup.read_text(encoding="utf-8"))["v"], 1)
            self.assertFalse(path.with_name(path.name + ".tmp").exists())

    def test_backup_failure_does_not_block_primary_state_save(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.json"
            ps.save_state_atomic(path, {ps.META_KEY: {"schema_version": 2}, "v": 1})
            with mock.patch.object(
                ps.shutil, "copy2", side_effect=OSError("backup unavailable")
            ):
                ps.save_state_atomic(
                    path, {ps.META_KEY: {"schema_version": 2}, "v": 2}
                )
            self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["v"], 2)

    def test_stale_lock_file_does_not_block_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "state.json"
            lock_path = state_path.with_name(state_path.name + ".lock")
            lock_path.write_text("pid=stale\n", encoding="utf-8")
            with ps.state_lock(state_path):
                self.assertTrue(lock_path.exists())
            self.assertFalse(lock_path.exists())

    def test_active_lock_blocks_a_second_publisher(self):
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "state.json"
            with ps.state_lock(state_path):
                with self.assertRaises(ps.PublicationStateError):
                    with ps.state_lock(state_path):
                        self.fail("second publisher acquired an active lock")

    def test_explicit_existing_id_is_blocked(self):
        catalog = {"alpha": {"id": "alpha"}}
        state = {ps.META_KEY: {"schema_version": 2}, "alpha": {"video_id": "vid-1"}}
        with self.assertRaises(ps.PublicationStateError):
            ps.candidate_ids(catalog, state, "alpha")

    def test_duration_parser(self):
        self.assertEqual(ps.parse_iso8601_duration("PT3M54S"), 234.0)
        self.assertEqual(ps.parse_iso8601_duration("PT1H2M3.5S"), 3723.5)
        self.assertIsNone(ps.parse_iso8601_duration("not-a-duration"))

    def test_remote_reconciliation_accepts_recorded_other_channel(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            catalog = ps.load_catalog(_write_item(root))
            state = {
                ps.META_KEY: {"schema_version": 2},
                "alpha": {"video_id": "old-video", "phase": "uploaded_unknown"},
            }
            remote = [{
                "video_id": "old-video",
                "channel_id": "UC-OLD",
                "title": "알파 — 중독백과",
                "duration_seconds": 12.5,
                "privacy_status": "public",
                "upload_status": "processed",
                "processing_status": "succeeded",
            }]
            adopted, conflicts = ps.reconcile_remote(
                catalog, state, remote, "UC-TARGET", root
            )
            self.assertEqual(adopted, [])
            self.assertEqual(conflicts, [])
            self.assertEqual(state["alpha"]["channel_id"], "UC-OLD")
            self.assertEqual(state[ps.META_KEY]["target_channel_id"], "UC-TARGET")

    def test_unrecorded_match_can_only_be_adopted_from_target_channel(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            catalog = ps.load_catalog(_write_item(root))
            state = {ps.META_KEY: {"schema_version": 2}}
            other = [{
                "video_id": "other-video",
                "channel_id": "UC-OTHER",
                "title": "알파 — 중독백과",
                "duration_seconds": 12.4,
            }]
            adopted, conflicts = ps.reconcile_remote(
                catalog, state, other, "UC-TARGET", root
            )
            self.assertEqual(adopted, [])
            self.assertEqual(conflicts, [])
            self.assertNotIn("alpha", state)

    def test_interrupted_upload_is_recovered_from_owner_file_details(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            catalog = ps.load_catalog(_write_item(root))
            source = ps.source_fingerprint(catalog["alpha"], root)
            state = {
                ps.META_KEY: {"schema_version": 2},
                "alpha": {
                    "phase": "prepared_private_upload",
                    "channel_id": "UC-TARGET",
                    "source": source,
                    "source_verification": {"status": "verified_before_upload"},
                },
            }
            remote = [{
                "video_id": "recovered-video",
                "channel_id": "UC-TARGET",
                "title": "알파 — 중독백과",
                "description": "콘텐츠 ID: enc-id:alpha",
                "duration_seconds": 12.4,
                "file_size_bytes": source["size_bytes"],
                "privacy_status": "private",
                "upload_status": "processed",
                "processing_status": "succeeded",
            }]
            adopted, conflicts = ps.reconcile_remote(
                catalog, state, remote, "UC-TARGET", root
            )
            self.assertEqual(adopted, ["alpha"])
            self.assertEqual(conflicts, [])
            self.assertEqual(state["alpha"]["video_id"], "recovered-video")
            self.assertEqual(
                state["alpha"]["source_verification"]["status"],
                "verified_recovered_after_interrupt",
            )

    def test_prepared_upload_without_remote_match_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            catalog = ps.load_catalog(_write_item(root))
            state = {
                ps.META_KEY: {"schema_version": 2},
                "alpha": {
                    "phase": "prepared_private_upload",
                    "channel_id": "UC-TARGET",
                    "source": ps.source_fingerprint(catalog["alpha"], root),
                    "source_verification": {"status": "verified_before_upload"},
                },
            }
            adopted, conflicts = ps.reconcile_remote(
                catalog, state, [], "UC-TARGET", root
            )
            self.assertEqual(adopted, [])
            self.assertEqual(len(conflicts), 1)
            self.assertIn("자동 재업로드 금지", conflicts[0])

    def test_explicit_youtube_limit_rejection_remains_retryable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            catalog = ps.load_catalog(_write_item(root))
            state = {
                ps.META_KEY: {"schema_version": 2},
                "alpha": {
                    "phase": "prepared_private_upload",
                    "channel_id": "UC-TARGET",
                    "source": ps.source_fingerprint(catalog["alpha"], root),
                    "source_verification": {"status": "verified_before_upload"},
                    "last_error": {
                        "stage": "youtube_limit",
                        "at": "2026-10-06T14:04:48+00:00",
                    },
                },
            }
            adopted, conflicts = ps.reconcile_remote(
                catalog, state, [], "UC-TARGET", root
            )
            self.assertEqual(adopted, [])
            self.assertEqual(conflicts, [])

    def test_db_id_is_adopted_and_conflict_is_blocked(self):
        catalog = {"alpha": {"id": "alpha"}}
        state = {ps.META_KEY: {"schema_version": 2}}
        adopted, conflicts = ps.merge_db_video_ids(catalog, state, {"alpha": "db-video"})
        self.assertEqual(adopted, ["alpha"])
        self.assertEqual(conflicts, [])
        self.assertEqual(state["alpha"]["video_id"], "db-video")
        _, conflicts = ps.merge_db_video_ids(catalog, state, {"alpha": "different"})
        self.assertEqual(len(conflicts), 1)

    def test_missing_db_catalog_row_is_blocked(self):
        catalog = {"alpha": {"id": "alpha"}, "beta": {"id": "beta"}}
        state = {ps.META_KEY: {"schema_version": 2}}
        _, conflicts = ps.merge_db_video_ids(catalog, state, {"alpha": None})
        self.assertEqual(conflicts, ["beta: DB에 백과 항목 행이 없음"])

    def test_verified_audit_rejects_bad_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            catalog = ps.load_catalog(_write_item(root))
            source = ps.source_fingerprint(catalog["alpha"], root)
            audit_path = root / "audit.json"
            audit_path.write_text(json.dumps({
                "status": "VERIFIED",
                "audited_at": "2026-10-05",
                "videos": [{
                    "term_id": "alpha",
                    "video_id": "vid",
                    "title": "잘못된 제목",
                    "youtube_duration_iso": "PT12S",
                    "channel_id": "UC-OLD",
                    "public": True,
                    "unlisted": False,
                    "playability": "OK",
                    "source": {
                        "path": source["relative_path"],
                        "size_bytes": source["size_bytes"],
                        "duration_seconds": 12.4,
                        "sha256": source["sha256"],
                    },
                }],
            }, ensure_ascii=False), encoding="utf-8")
            state = {ps.META_KEY: {"schema_version": 2}}
            adopted, conflicts = ps.apply_verified_audit(
                audit_path, catalog, state, root
            )
            self.assertEqual(adopted, [])
            self.assertEqual(len(conflicts), 1)
            self.assertNotIn("alpha", state)

    def test_fixed_catalog_anchor_detects_a_missing_complete_pair(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video_dir = _write_item(root)
            with self.assertRaises(ps.PublicationStateError):
                ps.load_catalog(
                    video_dir,
                    expected_count=2,
                    expected_ids_sha256="not-the-real-inventory",
                )

    def test_sidecar_change_after_catalog_load_blocks_fingerprint(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video_dir = _write_item(root)
            catalog = ps.load_catalog(video_dir)
            sidecar = video_dir / "alpha.json"
            changed = json.loads(sidecar.read_text(encoding="utf-8"))
            changed["term_ko"] = "변경된 제목"
            sidecar.write_text(
                json.dumps(changed, ensure_ascii=False), encoding="utf-8"
            )
            with self.assertRaises(ps.PublicationStateError):
                ps.source_fingerprint(catalog["alpha"], root)

    def test_sidecar_change_during_catalog_read_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video_dir = _write_item(root)
            sidecar = video_dir / "alpha.json"
            original_read_bytes = Path.read_bytes
            changed_once = False

            def read_then_change(path):
                nonlocal changed_once
                payload = original_read_bytes(path)
                if path == sidecar and not changed_once:
                    changed_once = True
                    changed = json.loads(payload.decode("utf-8"))
                    changed["term_ko"] = "읽는 도중 변경된 제목"
                    path.write_text(
                        json.dumps(changed, ensure_ascii=False), encoding="utf-8"
                    )
                return payload

            with mock.patch.object(Path, "read_bytes", new=read_then_change):
                with self.assertRaises(ps.PublicationStateError):
                    ps.load_catalog(video_dir)

    def test_marker_is_required_for_automatic_remote_adoption(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            catalog = ps.load_catalog(_write_item(root))
            title_only = [{
                "video_id": "title-only",
                "channel_id": "UC-TARGET",
                "title": "알파 — 중독백과",
                "description": "no stable marker",
                "duration_seconds": 12.4,
            }]
            state = {ps.META_KEY: {"schema_version": 2}}
            adopted, conflicts = ps.reconcile_remote(
                catalog, state, title_only, "UC-TARGET", root
            )
            self.assertEqual(adopted, [])
            self.assertEqual(len(conflicts), 1)

            marked = [{**title_only[0], "video_id": "marked",
                       "description": "콘텐츠 ID: enc-id:alpha"}]
            state = {ps.META_KEY: {"schema_version": 2}}
            adopted, conflicts = ps.reconcile_remote(
                catalog, state, marked, "UC-TARGET", root
            )
            self.assertEqual(adopted, ["alpha"])
            self.assertEqual(conflicts, [])
            self.assertNotIn("source", state["alpha"])
            self.assertIn("candidate_source", state["alpha"])


class UploaderSafetyTests(unittest.TestCase):
    def test_explicit_publisher_db_env_missing_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "missing.env"
            with mock.patch.dict(
                os.environ, {"PUBLISHER_DB_ENV": str(missing)}, clear=False
            ):
                with self.assertRaises(RuntimeError):
                    fetch._load_env()

    def test_explicit_publisher_db_env_incomplete_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / "publisher-db.env"
            env_path.write_text("DB_HOST=db.example\n", encoding="utf-8")
            with mock.patch.dict(
                os.environ, {"PUBLISHER_DB_ENV": str(env_path)}, clear=False
            ):
                with self.assertRaises(RuntimeError):
                    fetch._load_env()

    def test_fresh_state_dry_run_applies_audit_in_memory_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video_dir = _write_item(root)
            catalog = ps.load_catalog(video_dir)
            source = ps.source_fingerprint(catalog["alpha"], root)
            audit_path = root / "audit.json"
            audit_path.write_text(json.dumps({
                "status": "VERIFIED",
                "audited_at": "2026-10-05",
                "videos": [{
                    "term_id": "alpha", "video_id": "existing-video",
                    "title": "알파 — 중독백과",
                    "youtube_duration_iso": "PT12.4S",
                    "upload_date": "2026-10-05T00:00:00+00:00",
                    "channel_id": "UC-OLD", "public": True,
                    "unlisted": False, "playability": "OK",
                    "source": {
                        "path": source["relative_path"],
                        "size_bytes": source["size_bytes"],
                        "duration_seconds": 12.4,
                        "sha256": source["sha256"],
                    },
                }],
            }, ensure_ascii=False), encoding="utf-8")
            state_path = root / "missing-state.json"
            ids_hash = hashlib.sha256(b"alpha").hexdigest()
            observed = {}

            def inspect(_catalog, state, *_args):
                observed.update(state)

            with (
                mock.patch.object(uy, "BASE", root),
                mock.patch.object(uy, "VIDEO_DIR", video_dir),
                mock.patch.object(uy, "STATE_PATH", state_path),
                mock.patch.object(uy, "AUDIT_PATH", audit_path),
                mock.patch.object(uy, "EXPECTED_CATALOG_COUNT", 1),
                mock.patch.object(uy, "EXPECTED_CATALOG_IDS_SHA256", ids_hash),
                mock.patch.object(uy, "_dry_run", side_effect=inspect),
                mock.patch.object(uy, "force_utf8"),
                mock.patch.object(sys, "argv", ["upload_youtube.py", "--dry-run", "--all"]),
            ):
                uy.main()
            self.assertEqual(observed["alpha"]["video_id"], "existing-video")
            self.assertFalse(state_path.exists())

    def test_blank_db_video_id_is_updated_as_unlinked(self):
        conn = mock.MagicMock()
        conn.__enter__.return_value = conn
        cursor = mock.MagicMock()
        conn.cursor.return_value.__enter__.return_value = cursor
        cursor.fetchone.return_value = ("   ",)
        cursor.rowcount = 1
        with mock.patch.object(uy, "_db_connect", return_value=conn):
            result = uy.update_video_id("alpha", "vid")
        self.assertEqual(result, "synced")
        self.assertIn("btrim(youtube_video_id) = ''", cursor.execute.call_args_list[1].args[0])
        conn.commit.assert_called_once()

    def test_metadata_is_private_by_default_and_has_stable_marker(self):
        item = {
            "id": "alpha", "term_ko": "알파", "term_en": "Alpha",
            "category": "behavioral", "definition": "definition", "toc": [],
        }
        body = uy.build_metadata("alpha", item)
        self.assertEqual(body["status"]["privacyStatus"], "private")
        self.assertIn("enc-id:alpha", body["snippet"]["description"])

    def test_stable_marker_survives_long_description_truncation(self):
        item = {
            "id": "alpha", "term_ko": "알파", "term_en": "Alpha",
            "category": "behavioral", "definition": "가" * 6000, "toc": [],
        }
        description = uy.build_metadata("alpha", item)["snippet"]["description"]
        self.assertLessEqual(len(description), 4900)
        self.assertIn("enc-id:alpha", description)

    def test_channel_mismatch_blocks_before_writes(self):
        state = {ps.META_KEY: {"schema_version": 2}}
        with mock.patch.object(uy, "_own_channel", return_value={
            "channel_id": "UC-ACTUAL", "title": "wrong", "uploads_playlist_id": "UU"
        }):
            with self.assertRaises(ps.PublicationStateError):
                uy._assert_target_channel(object(), "UC-EXPECTED", state)

    def test_pinned_playlist_must_match_title_and_owner(self):
        request = mock.Mock()
        request.execute.return_value = {"items": [{
            "id": "PL-TARGET",
            "snippet": {
                "title": uy.PLAYLIST_TITLE,
                "channelId": "UC-TARGET",
            },
            "status": {"privacyStatus": "public"},
        }]}
        playlists = mock.Mock()
        playlists.list.return_value = request
        youtube = mock.Mock()
        youtube.playlists.return_value = playlists

        playlist_id = uy._ensure_playlist(
            youtube,
            expected_playlist_id="PL-TARGET",
            expected_channel_id="UC-TARGET",
            create_if_missing=False,
        )

        self.assertEqual(playlist_id, "PL-TARGET")
        playlists.insert.assert_not_called()

    def test_pinned_playlist_owner_mismatch_fails_closed(self):
        request = mock.Mock()
        request.execute.return_value = {"items": [{
            "id": "PL-TARGET",
            "snippet": {
                "title": uy.PLAYLIST_TITLE,
                "channelId": "UC-OTHER",
            },
        }]}
        playlists = mock.Mock()
        playlists.list.return_value = request
        youtube = mock.Mock()
        youtube.playlists.return_value = playlists

        with self.assertRaises(ps.PublicationStateError):
            uy._ensure_playlist(
                youtube,
                expected_playlist_id="PL-TARGET",
                expected_channel_id="UC-TARGET",
                create_if_missing=False,
            )
        playlists.insert.assert_not_called()

    def test_noninteractive_playlist_lookup_never_creates(self):
        first_request = mock.Mock()
        first_request.execute.return_value = {"items": []}
        playlists = mock.Mock()
        playlists.list.return_value = first_request
        playlists.list_next.return_value = None
        youtube = mock.Mock()
        youtube.playlists.return_value = playlists

        with self.assertRaises(ps.PublicationStateError):
            uy._ensure_playlist(youtube, create_if_missing=False)
        playlists.insert.assert_not_called()

    def test_remote_inventory_requests_processing_only_for_owned_uploads(self):
        state = {
            ps.META_KEY: {"schema_version": 2},
            "old": {"video_id": "external-video"},
        }
        calls = []

        def details(_youtube, ids, include_processing=False):
            calls.append((list(ids), include_processing))
            return []

        with (
            mock.patch.object(uy, "_iter_playlist_video_ids",
                              return_value=iter(["owned-video"])),
            mock.patch.object(uy, "_video_details", side_effect=details),
        ):
            uy._remote_inventory(
                object(), {"uploads_playlist_id": "UPLOADS"}, state,
                extra_video_ids=["owned-video", "db-external"],
            )
        self.assertEqual(calls, [
            (["owned-video"], True),
            (["external-video", "db-external"], False),
        ])

    def test_video_id_survives_playlist_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_path = root / "upload_state.json"
            catalog = ps.load_catalog(_write_item(root))
            state = {ps.META_KEY: {"schema_version": 2}}
            channel = {"channel_id": "UC-TARGET", "title": "target"}
            with (
                mock.patch.object(uy, "STATE_PATH", state_path),
                mock.patch.object(uy, "BASE", root),
                mock.patch.object(uy, "_upload_video", return_value="new-video"),
                mock.patch.object(uy, "_ensure_playlist_member", side_effect=RuntimeError("playlist down")),
                mock.patch.object(uy.time, "sleep"),
                mock.patch("builtins.print"),
            ):
                completed, failures = uy._upload_queue(
                    object(), channel, catalog, state, "PL", set(), None, True, 5
                )
            persisted = ps.load_state(state_path)
            self.assertEqual(completed, 0)
            self.assertEqual(len(failures), 1)
            self.assertEqual(persisted["alpha"]["video_id"], "new-video")
            self.assertEqual(persisted["alpha"]["last_error"]["stage"], "playlist")

    def test_pre_upload_fingerprint_failure_blocks_upload(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_path = root / "upload_state.json"
            catalog = ps.load_catalog(_write_item(root))
            state = {ps.META_KEY: {"schema_version": 2}}
            channel = {"channel_id": "UC-TARGET", "title": "target"}
            upload = mock.Mock(return_value="new-video")
            with (
                mock.patch.object(uy, "STATE_PATH", state_path),
                mock.patch.object(uy, "BASE", root),
                mock.patch.object(uy, "_upload_video", upload),
                mock.patch.object(uy, "source_fingerprint", side_effect=OSError("disk read")),
                mock.patch.object(uy.time, "sleep"),
                mock.patch("builtins.print"),
            ):
                _, failures = uy._upload_queue(
                    object(), channel, catalog, state, "PL", set(), None, True, 5
                )
            persisted = ps.load_state(state_path)
            self.assertEqual(len(failures), 1)
            self.assertNotIn("video_id", persisted["alpha"])
            upload.assert_not_called()

    def test_post_upload_source_change_keeps_id_and_blocks_playlist(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_path = root / "upload_state.json"
            catalog = ps.load_catalog(_write_item(root))
            state = {ps.META_KEY: {"schema_version": 2}}
            channel = {"channel_id": "UC-TARGET", "title": "target"}
            before = {"sha256": "a", "size_bytes": 10}
            after = {"sha256": "b", "size_bytes": 10}
            playlist = mock.Mock()
            with (
                mock.patch.object(uy, "STATE_PATH", state_path),
                mock.patch.object(uy, "BASE", root),
                mock.patch.object(uy, "_upload_video", return_value="new-video"),
                mock.patch.object(uy, "source_fingerprint", side_effect=[before, after]),
                mock.patch.object(uy, "_ensure_playlist_member", playlist),
                mock.patch.object(uy.time, "sleep"),
                mock.patch("builtins.print"),
            ):
                _, failures = uy._upload_queue(
                    object(), channel, catalog, state, "PL", set(), None, True, 5
                )
            persisted = ps.load_state(state_path)
            self.assertEqual(len(failures), 1)
            self.assertEqual(persisted["alpha"]["video_id"], "new-video")
            playlist.assert_not_called()

    def test_before_only_fingerprint_never_allows_publication(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            catalog = ps.load_catalog(_write_item(root))
            source = ps.source_fingerprint(catalog["alpha"], root)
            state = {
                ps.META_KEY: {"schema_version": 2},
                "alpha": {
                    "video_id": "vid",
                    "channel_id": "UC-TARGET",
                    "source": source,
                    "source_verification": {"status": "verified_before_upload"},
                },
            }
            remote = [{
                "video_id": "vid", "channel_id": "UC-TARGET",
                "privacy_status": "private", "upload_status": "processed",
                "processing_status": "succeeded", "failure_reason": None,
            }]
            with (
                mock.patch.object(uy, "BASE", root),
                mock.patch.object(uy, "STATE_PATH", root / "state.json"),
                mock.patch.object(uy, "_set_public") as publish,
                mock.patch.object(uy, "update_video_id") as db,
                mock.patch("builtins.print"),
            ):
                published, pending, failures = uy._publish_ready(
                    object(), {"channel_id": "UC-TARGET"}, catalog, state,
                    "PL", set(), remote,
                )
            self.assertEqual((published, pending, len(failures)), (0, 0, 1))
            publish.assert_not_called()
            db.assert_not_called()

    def test_processing_requires_both_success_signals_and_no_failure(self):
        self.assertTrue(uy._is_processed({
            "upload_status": "processed", "processing_status": "succeeded",
            "failure_reason": None,
        }))
        self.assertFalse(uy._is_processed({
            "upload_status": "processed", "processing_status": None,
            "failure_reason": None,
        }))
        self.assertFalse(uy._is_processed({
            "upload_status": "processed", "processing_status": "succeeded",
            "failure_reason": "rejected",
        }))

    def test_public_update_preserves_mutable_status(self):
        request = mock.Mock()
        request.execute.return_value = {"id": "vid"}
        videos = mock.Mock()
        videos.update.return_value = request
        youtube = mock.Mock()
        youtube.videos.return_value = videos
        current = {
            "mutable_status": {
                "privacyStatus": "private",
                "license": "creativeCommon",
                "embeddable": False,
                "publicStatsViewable": False,
                "selfDeclaredMadeForKids": False,
            }
        }
        uy._set_public(youtube, "vid", current)
        body = videos.update.call_args.kwargs["body"]
        self.assertEqual(body["status"]["privacyStatus"], "public")
        self.assertEqual(body["status"]["license"], "creativeCommon")
        self.assertFalse(body["status"]["embeddable"])
        self.assertFalse(body["status"]["publicStatsViewable"])

    def test_publish_persists_playlist_then_public_then_db(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            catalog = ps.load_catalog(_write_item(root))
            source = ps.source_fingerprint(catalog["alpha"], root)
            state = {
                ps.META_KEY: {"schema_version": 2},
                "alpha": {
                    "video_id": "vid",
                    "channel_id": "UC-TARGET",
                    "source": source,
                    "source_verification": {"status": "verified_before_and_after_upload"},
                },
            }
            private = {
                "video_id": "vid", "channel_id": "UC-TARGET",
                "privacy_status": "private", "upload_status": "processed",
                "processing_status": "succeeded", "failure_reason": None,
                "mutable_status": {"privacyStatus": "private"},
            }
            public = {**private, "privacy_status": "public",
                      "mutable_status": {"privacyStatus": "public"}}
            events = []

            def save(_path, current):
                events.append(("save", current["alpha"].get("phase")))

            with (
                mock.patch.object(uy, "BASE", root),
                mock.patch.object(uy, "STATE_PATH", root / "state.json"),
                mock.patch.object(uy, "_ensure_playlist_member",
                                  side_effect=lambda *args: events.append(("playlist", None))),
                mock.patch.object(uy, "_set_public",
                                  side_effect=lambda *args: events.append(("public", None))),
                mock.patch.object(uy, "_video_details", return_value=[public]),
                mock.patch.object(uy, "update_video_id",
                                  side_effect=lambda *args: events.append(("db", None)) or "synced"),
                mock.patch.object(uy, "save_state_atomic", side_effect=save),
                mock.patch.object(uy.time, "sleep"),
                mock.patch("builtins.print"),
            ):
                published, pending, failures = uy._publish_ready(
                    object(), {"channel_id": "UC-TARGET"}, catalog, state,
                    "PL", set(), [private],
                )
            self.assertEqual((published, pending, failures), (1, 0, []))
            self.assertLess(events.index(("playlist", None)),
                            events.index(("save", "playlisted_ready_to_publish")))
            self.assertLess(events.index(("save", "playlisted_ready_to_publish")),
                            events.index(("public", None)))
            self.assertLess(events.index(("public", None)),
                            events.index(("save", "published_pending_db")))
            self.assertLess(events.index(("save", "published_pending_db")),
                            events.index(("db", None)))
            self.assertLess(events.index(("db", None)),
                            events.index(("save", "published_db_synced")))

    def test_other_channel_public_video_only_syncs_db(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            catalog = ps.load_catalog(_write_item(root))
            source = ps.source_fingerprint(catalog["alpha"], root)
            state = {
                ps.META_KEY: {"schema_version": 2},
                "alpha": {
                    "video_id": "vid",
                    "channel_id": "UC-OTHER",
                    "source": source,
                    "source_verification": {"status": "verified"},
                },
            }
            remote = [{
                "video_id": "vid", "channel_id": "UC-OTHER",
                "privacy_status": "public", "upload_status": "processed",
                "processing_status": None, "failure_reason": None,
            }]
            with (
                mock.patch.object(uy, "BASE", root),
                mock.patch.object(uy, "STATE_PATH", root / "state.json"),
                mock.patch.object(uy, "_set_public") as publish,
                mock.patch.object(uy, "_ensure_playlist_member") as playlist,
                mock.patch.object(uy, "update_video_id", return_value="synced") as db,
                mock.patch.object(uy, "save_state_atomic"),
                mock.patch("builtins.print"),
            ):
                published, pending, failures = uy._publish_ready(
                    object(), {"channel_id": "UC-TARGET"}, catalog, state,
                    "PL", set(), remote,
                )
            self.assertEqual((published, pending, failures), (1, 0, []))
            publish.assert_not_called()
            playlist.assert_not_called()
            db.assert_called_once_with("alpha", "vid")

    def test_db_failure_after_publication_stops_remaining_batch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_item(root, "alpha", "알파")
            _write_item(root, "beta", "베타")
            catalog = ps.load_catalog(root / "video_v2")
            state = {ps.META_KEY: {"schema_version": 2}}
            remote = []
            for term in ("alpha", "beta"):
                state[term] = {
                    "video_id": f"vid-{term}",
                    "channel_id": "UC-TARGET",
                    "source": ps.source_fingerprint(catalog[term], root),
                    "source_verification": {
                        "status": "verified_before_and_after_upload"
                    },
                }
                remote.append({
                    "video_id": f"vid-{term}", "channel_id": "UC-TARGET",
                    "privacy_status": "private", "upload_status": "processed",
                    "processing_status": "succeeded", "failure_reason": None,
                    "mutable_status": {"privacyStatus": "private"},
                })
            refreshed = [{
                **remote[0], "privacy_status": "public",
                "mutable_status": {"privacyStatus": "public"},
            }]
            with (
                mock.patch.object(uy, "BASE", root),
                mock.patch.object(uy, "STATE_PATH", root / "state.json"),
                mock.patch.object(uy, "_ensure_playlist_member"),
                mock.patch.object(uy, "_set_public") as publish,
                mock.patch.object(uy, "_video_details", return_value=refreshed),
                mock.patch.object(uy, "update_video_id",
                                  side_effect=RuntimeError("DB unavailable")) as db,
                mock.patch.object(uy, "save_state_atomic"),
                mock.patch.object(uy.time, "sleep"),
                mock.patch("builtins.print"),
            ):
                published, pending, failures = uy._publish_ready(
                    object(), {"channel_id": "UC-TARGET"}, catalog, state,
                    "PL", set(), remote,
                )
            self.assertEqual((published, pending, len(failures)), (0, 0, 1))
            self.assertEqual(publish.call_count, 1)
            self.assertEqual(db.call_count, 1)


class ReconcileContinueTests(unittest.TestCase):
    """ENC-FIX-1: per-marker reconcile rules and a run that never stalls."""

    @staticmethod
    def _marked(video_id, published_at, duration, **extra):
        return {
            "video_id": video_id,
            "channel_id": "UC-TARGET",
            "title": "알파 — 중독백과",
            "description": "콘텐츠 ID: enc-id:alpha",
            "published_at": published_at,
            "duration_seconds": duration,
            **extra,
        }

    def test_single_marker_video_still_processing_is_adopted_by_exact_size(self):
        # The 10-09 addiction/blackout shape: 410 after YouTube kept the bytes,
        # one marked video stuck in processing with no duration yet.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            catalog = ps.load_catalog(_write_item(root))
            source = ps.source_fingerprint(catalog["alpha"], root)
            state = {
                ps.META_KEY: {"schema_version": 2},
                "alpha": {
                    "phase": "prepared_private_upload",
                    "channel_id": "UC-TARGET",
                    "source": source,
                    "source_verification": {"status": "verified_before_upload"},
                    "last_error": {"stage": "upload", "at": "2026-10-08T05:11:05+00:00"},
                },
            }
            remote = [self._marked(
                "stuck", "2026-10-08T05:10:56Z", None,
                file_size_bytes=source["size_bytes"],
                upload_status="uploaded", processing_status="processing",
            )]
            adopted, conflicts = ps.reconcile_remote(
                catalog, state, remote, "UC-TARGET", root
            )
            self.assertEqual(adopted, ["alpha"])
            self.assertEqual(conflicts, [])
            self.assertEqual(state["alpha"]["video_id"], "stuck")
            self.assertNotIn("duplicates", state["alpha"])
            self.assertNotIn("needs_review", state["alpha"])
            self.assertEqual(ps.candidate_ids(catalog, state), [])

            # A wrong size with no duration is not proof.
            state = {ps.META_KEY: {"schema_version": 2}}
            remote[0]["file_size_bytes"] = source["size_bytes"] + 1
            adopted, conflicts = ps.reconcile_remote(
                catalog, state, remote, "UC-TARGET", root
            )
            self.assertEqual(adopted, [])
            self.assertIn("needs_review", state["alpha"])

    def test_several_marker_videos_keep_earliest_match_and_list_duplicates(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            catalog = ps.load_catalog(_write_item(root))
            state = {ps.META_KEY: {"schema_version": 2}}
            remote = [
                self._marked("later", "2026-10-08T05:00:00Z", 13.0),
                self._marked("wrong-length", "2026-10-06T05:00:00Z", 99.0),
                self._marked("earliest", "2026-10-07T05:00:00Z", 11.0),
            ]
            adopted, conflicts = ps.reconcile_remote(
                catalog, state, remote, "UC-TARGET", root
            )
            self.assertEqual(adopted, ["alpha"])
            self.assertEqual(conflicts, [])
            self.assertEqual(state["alpha"]["video_id"], "earliest")
            duplicates = state["alpha"]["duplicates"]
            self.assertEqual(
                sorted(entry["video_id"] for entry in duplicates),
                ["later", "wrong-length"],
            )
            self.assertEqual(
                set(duplicates[0]),
                {"video_id", "title", "published_at", "duration_seconds"},
            )

    def test_no_marker_video_matching_duration_flags_only_that_term(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_item(root, "alpha", "알파")
            catalog = ps.load_catalog(_write_item(root, "beta", "베타"))
            state = {ps.META_KEY: {"schema_version": 2}}
            remote = [
                self._marked("a1", "2026-10-07T05:00:00Z", 40.0),
                self._marked("a2", "2026-10-08T05:00:00Z", None, file_size_bytes=1),
            ]
            adopted, conflicts = ps.reconcile_remote(
                catalog, state, remote, "UC-TARGET", root
            )
            self.assertEqual(adopted, [])
            self.assertEqual(len(conflicts), 1)
            self.assertTrue(conflicts[0].startswith("alpha:"))
            self.assertNotIn("video_id", state["alpha"])
            self.assertIn("reason", state["alpha"]["needs_review"])
            self.assertEqual(ps.candidate_ids(catalog, state), ["beta"])

            # Once the remote side is resolved the flag clears by itself.
            remote[0]["duration_seconds"] = 12.4
            adopted, conflicts = ps.reconcile_remote(
                catalog, state, remote, "UC-TARGET", root
            )
            self.assertEqual(conflicts, [])
            self.assertNotIn("needs_review", state["alpha"])

    def test_conflicted_term_is_skipped_and_next_item_still_uploads(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state_path = root / "upload_state.json"
            _write_item(root, "alpha", "알파")
            catalog = ps.load_catalog(_write_item(root, "beta", "베타"))
            state = {
                ps.META_KEY: {"schema_version": 2},
                # Interrupted before the id was saved and invisible remotely.
                "alpha": {
                    "phase": "prepared_private_upload",
                    "channel_id": "UC-TARGET",
                    "source": ps.source_fingerprint(catalog["alpha"], root),
                    "source_verification": {"status": "verified_before_upload"},
                },
            }
            adopted, conflicts = ps.reconcile_remote(
                catalog, state, [], "UC-TARGET", root
            )
            self.assertEqual(len(conflicts), 1)
            channel = {"channel_id": "UC-TARGET", "title": "target"}
            upload = mock.Mock(return_value="beta-video")
            with (
                mock.patch.object(uy, "STATE_PATH", state_path),
                mock.patch.object(uy, "BASE", root),
                mock.patch.object(uy, "_upload_video", upload),
                mock.patch.object(uy, "_ensure_playlist_member", return_value=True),
                mock.patch.object(uy.time, "sleep"),
                mock.patch("builtins.print"),
            ):
                completed, failures = uy._upload_queue(
                    object(), channel, catalog, state, "PL", set(), None, True, 5
                )
            self.assertEqual(upload.call_count, 1)
            self.assertEqual(completed, 1)
            self.assertEqual(failures, [])
            persisted = ps.load_state(state_path)
            self.assertEqual(persisted["beta"]["video_id"], "beta-video")
            self.assertNotIn("video_id", persisted["alpha"])
            self.assertEqual(uy.upload_exit_code(1, completed, failures), 0)
            # Exit 2 is reserved for "could not upload at all".
            self.assertEqual(uy.upload_exit_code(1, 0, [("beta", "network")]), 2)
            self.assertEqual(uy.upload_exit_code(1, 0, [("beta", uy.LIMIT_FAILURE)]), 0)
            self.assertEqual(uy.upload_exit_code(0, 0, []), 0)


if __name__ == "__main__":
    unittest.main()
