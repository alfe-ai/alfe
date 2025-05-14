#!/usr/bin/env python3

import sys
import os
from PIL import Image

def main():
    # Allow an optional command-line argument for the source image path.
    if len(sys.argv) > 1:
        image_path = sys.argv[1]
    else:
        image_path = 'Minimalist_favicon_design_featuring_a_single_styli.png'

    print(f"[DEBUG] Using image: {image_path}")

    # Use the current working directory as the output location
    favicon_dir = os.getcwd()
    print(f"[DEBUG] Using output directory for favicons => {favicon_dir}")

    if not os.path.exists(favicon_dir):
        print(f"[DEBUG] Creating directory => {favicon_dir}")
        os.makedirs(favicon_dir, exist_ok=True)

    # Attempt to open the image
    try:
        img = Image.open(image_path)
    except FileNotFoundError:
        print("[ERROR] The provided image file was not found. Aborting.")
        return
    except Exception as e:
        print(f"[ERROR] Could not open the image: {e}")
        return

    # 1) Create a multi-size favicon
    favicon_sizes = [(16, 16), (32, 32), (48, 48), (64, 64)]
    multi_output_path = os.path.join(favicon_dir, 'alfe_favicon.ico')
    try:
        img.save(multi_output_path, format='ICO', sizes=favicon_sizes)
        print(f"[DEBUG] Multi-size favicon saved as {multi_output_path}")
    except Exception as e:
        print(f"[ERROR] Failed to save multi-size favicon: {e}")

    # 2) Create a single 64x64 favicon
    single_64_output_path = os.path.join(favicon_dir, 'alfe_favicon_64x64.ico')
    try:
        img.save(single_64_output_path, format='ICO', sizes=[(64, 64)])
        print(f"[DEBUG] 64x64 favicon saved as {single_64_output_path}")
    except Exception as e:
        print(f"[ERROR] Failed to save 64x64 favicon: {e}")

    # 3) Create another single 64x64 favicon (mimicking prior second variant)
    clean_64_output_path = os.path.join(favicon_dir, 'alfe_favicon_clean_64x64.ico')
    try:
        img.save(clean_64_output_path, format='ICO', sizes=[(64, 64)])
        print(f"[DEBUG] Additional 64x64 favicon saved as {clean_64_output_path}")
    except Exception as e:
        print(f"[ERROR] Failed to save additional 64x64 favicon: {e}")

if __name__ == "__main__":
    main()
