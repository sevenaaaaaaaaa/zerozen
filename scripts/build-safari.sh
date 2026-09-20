#!/usr/bin/env bash
# 把 dist/safari 转换成 Xcode 工程（Safari Web Extension）
# 需要 Xcode 与命令行工具：xcode-select --install
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/dist/safari"
APP_NAME="${APP_NAME:-ZeroZen}"
BUNDLE_ID="${BUNDLE_ID:-com.zerozen.adblocker}"
OUT_DIR="${OUT_DIR:-$ROOT/dist/safari-app}"

if ! command -v xcrun >/dev/null 2>&1; then
  echo "未找到 xcrun，请先安装 Xcode 并运行: xcode-select --install"
  exit 1
fi

if [ ! -d "$SRC" ]; then
  echo "缺少 $SRC，先运行: npm run build"
  exit 1
fi

rm -rf "$OUT_DIR"
xcrun safari-web-extension-converter "$SRC" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --project-location "$OUT_DIR" \
  --no-open \
  --force

cat <<EOF

转换完成：$OUT_DIR/$APP_NAME

后续步骤：
  1. 用 Xcode 打开 $OUT_DIR/$APP_NAME/$APP_NAME.xcodeproj
  2. 选择 macOS target，Signing & Capabilities 里选择你的开发者账号
  3. 点 Run 运行一次（会把扩展注册到系统）
  4. Safari -> 设置 -> 扩展 -> 勾选 ZeroZen 并允许访问所有网站
  5. 若需在 iOS 上使用，选择 iOS target 重新 Run，然后在 设置 -> Safari -> 扩展 中启用

注意：Safari 需要 macOS 13+/iOS 16.4+ 才支持 declarativeNetRequest，低版本仅外观规则生效。
EOF
