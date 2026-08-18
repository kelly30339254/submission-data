"""把软件内置编辑包合并进 submission-editors.json。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

CRAWLER = Path(__file__).resolve().parents[1]
SOFTWARE = CRAWLER.parent / "投稿软件"
sys.path.insert(0, str(SOFTWARE))

from app.builtin_pack import load_builtin_editors  # noqa: E402

SRC = CRAWLER / "submission-editors.json"
PACK = SOFTWARE / "app" / "data" / "builtin_editors.dat"
STATUS_CODE = {"正常收稿": 1, "停止收稿": 3, "未核实": 0}


def split_genres(text: str) -> list[str]:
    if not text:
        return []
    return [p.strip() for p in str(text).replace(" / ", "/").split("/") if p.strip()]


def infer_qq(email: str) -> str:
    local, _, domain = email.partition("@")
    if domain.lower() == "qq.com" and local.isdigit() and 5 <= len(local) <= 11:
        return local
    return ""


def main() -> None:
    old = json.loads(SRC.read_text(encoding="utf-8"))
    pack = load_builtin_editors(str(PACK))
    pack_by_email = {
        (p.get("email") or "").strip().lower(): p
        for p in pack
        if (p.get("email") or "").strip()
    }

    max_id = max((e.get("id") or 0) for e in old)
    merged: list[dict] = []
    seen: set[str] = set()
    overlay_hits = 0

    for e in old:
        email = (e.get("email") or "").strip()
        key = email.lower()
        if not email:
            merged.append(e)
            continue
        if key in seen:
            continue
        seen.add(key)
        # 已有记录保留原字段（QQ/来源/状态），只补空的要求/品类。
        p = pack_by_email.get(key)
        if p:
            notes = (p.get("notes") or "").strip()
            if notes and not (e.get("requirements") or "").strip():
                e["requirements"] = notes
                overlay_hits += 1
            payment = (p.get("fee_info") or "").strip()
            if payment and not (e.get("payment") or "").strip():
                e["payment"] = payment
                overlay_hits += 1
            work = split_genres(p.get("genres") or "")
            if work and not e.get("workTypes"):
                e["workTypes"] = work
                overlay_hits += 1
        merged.append(e)

    added = 0
    for p in pack:
        email = (p.get("email") or "").strip()
        key = email.lower()
        if not email or key in seen:
            continue
        seen.add(key)
        max_id += 1
        added += 1
        platform = (p.get("platform") or "").strip()
        if platform == "未知平台":
            platform = ""
        status = (p.get("status") or "").strip() or "未核实"
        name = (p.get("name") or "").strip() or email
        merged.append({
            "id": max_id,
            "name": name,
            "platform": platform,
            "role": "编辑",
            "status": status,
            "status_code": STATUS_CODE.get(status, 0),
            "workTypes": split_genres(p.get("genres") or ""),
            "payment": p.get("fee_info") or "",
            "reviewDays": "",
            "submitDays": "",
            "email": email,
            "qq": infer_qq(email),
            "wechat": "",
            "requirements": p.get("notes") or "",
            "likes": 0,
            "收录日期": (p.get("created_at") or "")[:10],
            "更新日期": "",
            "官网": "",
            "小红书": "",
            "source": "builtin-pack-2979",
            "source_url": p.get("source_url") or "",
        })

    SRC.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    emails = {
        (e.get("email") or "").strip().lower()
        for e in merged
        if (e.get("email") or "").strip()
    }
    plats = {(e.get("platform") or "").strip() or "未知" for e in merged}
    empty = sum(1 for e in merged if not (e.get("email") or "").strip())
    print(
        f"rows={len(merged)} emails={len(emails)} platforms={len(plats)} "
        f"added={added} overlay_hits={overlay_hits} empty_email={empty}"
    )


if __name__ == "__main__":
    main()
