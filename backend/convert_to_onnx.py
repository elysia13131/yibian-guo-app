import os
import torch
from pathlib import Path
from shutil import copy2

MODEL_PATH = r"E:\一遍过\backend\model_scope_cache\OpenBMB\MiniCPM-V-4___6"
OUTPUT_DIR = r"E:\一遍过\backend\onnx_output"
CACHE_DIR = Path(r"E:\一遍过\backend\model_cache")

os.makedirs(OUTPUT_DIR, exist_ok=True)
CACHE_DIR.mkdir(parents=True, exist_ok=True)

print(f"Transformers: {__import__('transformers').__version__}")

print("=== 加载模型 ===")
from transformers import AutoConfig, AutoModelForImageTextToText

model = AutoModelForImageTextToText.from_pretrained(
    MODEL_PATH,
    trust_remote_code=True,
)
model.eval()
print(f"模型已加载, 参数量: {model.num_parameters():,}")

output_path = Path(OUTPUT_DIR) / "model.onnx"

print("\n=== 使用 torch.onnx.export 导出 ===")
dummy_input_ids = torch.ones((1, 128), dtype=torch.long)
dummy_attention_mask = torch.ones((1, 128), dtype=torch.long)
dummy_pixel_values = torch.ones((1, 3, 224, 224), dtype=torch.float32)

with torch.no_grad():
    torch.onnx.export(
        model,
        (dummy_input_ids, dummy_attention_mask, dummy_pixel_values),
        output_path,
        input_names=["input_ids", "attention_mask", "pixel_values"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq_len"},
            "attention_mask": {0: "batch", 1: "seq_len"},
            "pixel_values": {0: "batch"},
        },
        opset_version=14,
    )

size_mb = output_path.stat().st_size / 1024 / 1024
print(f"✅ ONNX 导出成功! {size_mb:.1f} MB")

print("\n=== 复制到 model_cache ===")
for f in ["config.json"]:
    src = Path(MODEL_PATH) / f
    if src.exists():
        copy2(src, CACHE_DIR / f)
        print(f"  {f} -> model_cache/{f}")

# 复制 ONNX
for f in Path(OUTPUT_DIR).glob("*.onnx"):
    name = str(f.name).replace("/", "_")
    copy2(f, CACHE_DIR / name)
    print(f"  {f.name} -> model_cache/{name} ({size_mb:.1f} MB)")

print(f"\n  model_cache 内容:")
for f in sorted(CACHE_DIR.iterdir()):
    s = f.stat().st_size / 1024 / 1024
    print(f"    {f.name} ({s:.1f} MB)")
