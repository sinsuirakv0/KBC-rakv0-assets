import hashlib
import json
import pathlib
import sys
import zipfile


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


root, output = map(pathlib.Path, sys.argv[1:3])
revision, repository, tag = sys.argv[3:6]
current = read_json(root / "metadata/jp/current.json")
integrated = read_json(root / "metadata/jp/integrated.json")
if integrated["header"]["buildId"] != current["buildId"] or integrated["header"]["datasetId"] != current["datasetId"]:
    raise ValueError("Integrated/current mismatch")
base = (root / "jp/Integrated-data").resolve()
actual = sorted(path.relative_to(base).as_posix() for path in base.rglob("*") if path.is_file())
if actual != sorted(integrated["files"]):
    raise ValueError("Integrated files differ from manifest")
output.mkdir(parents=True, exist_ok=True)
groups = {}
for name, entry in sorted(integrated["files"].items()):
    path = base / name
    if path.is_symlink() or not path.resolve().is_relative_to(base):
        raise ValueError("Unsafe integrated path")
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if path.stat().st_size != entry["size"] or digest != entry["sha256"]:
        raise ValueError(f"Corrupt integrated file: {name}")
    groups.setdefault(name.split("/")[0], []).append(name)
archives = {}
for group, names in groups.items():
    archive_path = output / f"{group}.zip"
    with zipfile.ZipFile(archive_path, "w", allowZip64=True) as archive:
        for name in names:
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_STORED if pathlib.PurePosixPath(name).suffix.lower() in {".ogg", ".caf", ".mp3", ".png", ".jpg", ".pack", ".list"} else zipfile.ZIP_DEFLATED
            with (base / name).open("rb") as source, archive.open(info, "w", force_zip64=True) as target:
                while chunk := source.read(1024 * 1024):
                    target.write(chunk)
    with zipfile.ZipFile(archive_path) as archive:
        if archive.namelist() != names or archive.testzip() is not None:
            raise ValueError("ZIP validation failed")
    size = archive_path.stat().st_size
    if size >= 1_900_000_000:
        raise ValueError("Release asset exceeds size limit")
    with archive_path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    archives[group] = {"file": archive_path.name, "size": size, "sha256": digest, "fileCount": len(names), "uncompressedSize": sum(integrated["files"][name]["size"] for name in names), "url": f"https://github.com/{repository}/releases/download/{tag}/{archive_path.name}"}
manifest = {"schemaVersion": 1, "header": integrated["header"], "revision": revision, "repository": repository, "tag": tag, "archives": archives}
(output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=True) + "\n", encoding="utf-8")
print(json.dumps({"versionCode": current["versionCode"], "archives": len(archives), "files": len(actual), "musicFiles": len(groups.get("music", []))}))
