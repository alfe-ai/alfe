from PIL import Image

# Load the generated minimalist favicon image
image_path = '/mnt/data/Minimalist_favicon_design_featuring_a_single_styli.png'
img = Image.open(image_path)

# Resize to common favicon sizes and save as .ico
favicon_sizes = [(16, 16), (32, 32), (48, 48), (64, 64)]
ico_output_path = '/mnt/data/alfe_favicon.ico'
img.save(ico_output_path, format='ICO', sizes=favicon_sizes)

ico_output_path
