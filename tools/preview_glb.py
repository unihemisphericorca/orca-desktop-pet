"""Quick look at an imported GLB: import, frame it, render side / three-quarter / front.

    blender -b -P tools/preview_glb.py -- --src assets/orca-bought.glb --prefix D:/repos/orca-pet/bought
"""
import argparse
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--src", required=True)
ap.add_argument("--prefix", required=True)
ap.add_argument("--samples", type=int, default=48)
args = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.src)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
print("IMPORTED:", [(o.name, len(o.data.vertices), len(o.data.polygons)) for o in meshes])
for o in meshes:
    for slot in o.material_slots:
        m = slot.material
        if not m:
            continue
        print("MATERIAL:", m.name, "| nodes:", [n.type for n in m.node_tree.nodes] if m.use_nodes else "none")

lo = Vector((1e9,) * 3)
hi = Vector((-1e9,) * 3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
        hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
center = (lo + hi) * 0.5
size = hi - lo
radius = max(size) * 0.5
print("BOUNDS size:", tuple(round(v, 2) for v in size))

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.render.resolution_x = 1000
scene.render.resolution_y = 640
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"

world = bpy.data.worlds.new("W")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.016, 0.045, 0.075, 1)
scene.world = world

cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = 50
cam = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

for name, direction in [
    ("side", Vector((1.0, 0.02, 0.06))),
    ("threequarter", Vector((0.8, 0.5, 0.28))),
    ("front", Vector((0.08, 1.0, 0.12))),
]:
    cam.location = center + direction.normalized() * (radius * 3.1)
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()

    for o in [x for x in scene.objects if x.type == "LIGHT"]:
        bpy.data.objects.remove(o, do_unlink=True)
    for lname, offset, energy, color in [
        ("Key", (0.9, 0.8, 0.9), 900, (1.0, 0.98, 0.95)),
        ("Rim", (-0.9, 0.6, -0.8), 900, (0.55, 0.80, 1.0)),
        ("Fill", (-0.7, 0.2, 0.6), 320, (0.72, 0.85, 1.0)),
    ]:
        ld = bpy.data.lights.new(lname, "AREA")
        ld.energy = energy
        ld.size = 6
        ld.color = color
        ob = bpy.data.objects.new(lname, ld)
        ob.location = center + Vector(offset) * radius * 1.8
        scene.collection.objects.link(ob)
        ob.rotation_euler = (center - ob.location).to_track_quat("-Z", "Y").to_euler()

    scene.render.filepath = "%s-%s.png" % (args.prefix, name)
    bpy.ops.render.render(write_still=True)
    print("RENDERED:", scene.render.filepath)
