"""Bound disk growth within LegalMate-owned deployment directories only."""
from pathlib import Path
import shutil

root = Path('/opt/legalmate')
active = (root / 'current').resolve()
backups = sorted(Path('/var/lib/legalmate/backups').iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
protected = {active}
for backup in backups[:1]:
    previous = backup / 'previous-release'
    if previous.is_file() and previous.read_text().strip():
        protected.add(Path(previous.read_text().strip()).resolve())
releases = sorted((root / 'releases').iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
for release in releases[3:]:
    if release.is_dir() and not release.is_symlink() and release.resolve() not in protected:
        shutil.rmtree(release)
for backup in backups[7:]:
    if backup.is_dir() and not backup.is_symlink():
        shutil.rmtree(backup)
