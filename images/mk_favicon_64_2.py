from PIL import Image

# Load the new minimalist image without the dot
new_image_path = '/mnt/data/Minimalist_favicon_design_featuring_a_single_styli.png'
img = Image.open(new_image_path)

# Resize to 64x64 and save as .ico
favicon_size = [(64, 64)]
ico_output_path_clean = '/mnt/data/alfe_favicon_clean_64x64.ico'
img.save(ico_output_path_clean, format='ICO', sizes=favicon_size)

ico_output_path_clean
