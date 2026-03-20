from __future__ import annotations

from hashlib import sha256
from pathlib import Path


def get_hostname(url: str) -> str:
    # Minimal URL hostname parser without urllib.
    no_scheme = url.split("//", 1)[-1]
    host_port = no_scheme.split("/", 1)[0]
    host_port = host_port.split("@", 1)[-1]
    host = host_port.split(":", 1)[0]
    return host or "unknown"


def env_has_flag(env_var: str) -> bool:
    try:
        data = Path("/proc/self/environ").read_bytes()
    except FileNotFoundError:
        return False
    return f"{env_var}=1".encode() in data


def cache_path(base_dir: Path, url: str) -> Path:
    hostname = get_hostname(url)
    url_hash = sha256(url.encode("utf-8")).hexdigest()
    return base_dir / hostname / f"{url_hash}.bin"


def cache_meta_path(base_dir: Path, url: str) -> Path:
    hostname = get_hostname(url)
    url_hash = sha256(url.encode("utf-8")).hexdigest()
    return base_dir / hostname / f"{url_hash}.url"


def read_cached_bytes(base_dir: Path, url: str) -> bytes | None:
    path = cache_path(base_dir, url)
    if path.exists():
        return path.read_bytes()
    return None


def write_cached_bytes(base_dir: Path, url: str, content: bytes) -> None:
    path = cache_path(base_dir, url)
    meta_path = cache_meta_path(base_dir, url)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    if not meta_path.exists():
        meta_path.write_text(url + "\n")


def should_refresh(env_var: str) -> bool:
    return env_has_flag(env_var)
