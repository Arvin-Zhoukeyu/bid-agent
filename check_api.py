"""Small live API smoke test. Never prints the API key or response body."""
from __future__ import annotations

import os
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse

from config import load_env
from engine import ROOT, _chat_completion


def main() -> int:
    load_env(ROOT / ".env")
    key = os.getenv("LLM_API_KEY", "").strip()
    base = os.getenv("LLM_BASE_URL", "").strip()
    model = os.getenv("LLM_MODEL", "").strip()
    if not key or not base or not model:
        print("配置不完整：请在 .env 中填写 LLM_API_KEY、LLM_BASE_URL 和 LLM_MODEL。")
        return 2
    parsed = urlparse(base)
    if parsed.scheme != "https" or not parsed.hostname:
        print("LLM_BASE_URL 应为 HTTPS API 基础地址，例如以 /compatible-mode/v1 结尾。")
        return 2

    print(f"测试模型：{model}")
    print(f"接口域名：{parsed.hostname}")
    start = time.monotonic()
    try:
        answer = _chat_completion([{"role": "user", "content": "请只回复：OK"}], max_tokens=16)
    except HTTPError as exc:
        print(f"API 请求失败：HTTP {exc.code}。请检查密钥、模型权限、接口地域和余额。")
        return 1
    except URLError as exc:
        print(f"网络连接失败：{type(exc.reason).__name__}。请检查网络与 API 地址。")
        return 1
    except Exception as exc:
        print(f"调用失败：{type(exc).__name__}。请检查配置或服务商状态。")
        return 1

    if not answer:
        print("API 已响应，但没有返回正文。")
        return 1
    print(f"API 连通成功：收到模型回复，耗时 {time.monotonic() - start:.1f} 秒。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
