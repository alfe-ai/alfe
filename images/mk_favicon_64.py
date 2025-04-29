from PIL import Image

# Reload the generated favicon image
image_path = '/mnt/data/Minimalist_favicon_design_featuring_a_single_styli.png'
img = Image.open(image_path)

# Resize to 64x64 only and save as .ico
favicon_size = [(64, 64)]
ico_output_path_single = '/mnt/data/alfe_favicon_64x64.ico'
img.save(ico_output_path_single, format='ICO', sizes=favicon_size)

ico_output_path_single
