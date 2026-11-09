"""Round the tip of the dorsal fin on the approved model, without touching anything else.

The buyer's mesh has a sharp, spike-like dorsal tip. Selecting only the vertices in the top
of the fin and running a few Laplacian smoothing passes rounds it into the falcate shape a
real orca has, and leaves the rest of the body untouched.

    blender -b -P tools/round_dorsal.py -- --src assets/orca-bought.glb --dst assets/orca-bought.glb
"""
import argparse
import math
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--src", required=True)
ap.add_argument("--dst", required=True)
ap.add_argument("--passes", type=int, default=6)
ap.add_argument("--z-frac", type=float, default=0.62)
ap.add_argument("--pull", type=float, default=0.35)
ap.add_argument("--render", default="")
args = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.src)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
print("meshes:", [(o.name, len(o.data.vertices)) for o in meshes])

for obj in meshes:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    # work in the object's own coordinates
    co = [v.co.copy() for v in obj.data.vertices]
    zs = [c.z for c in co]
    ys = [c.y for c in co]
    zmax, zmin = max(zs), min(zs)
    ymin, ymax = min(ys), max(ys)

    # the dorsal is the highest geometry, roughly amidships
    height = zmax - zmin
    length = ymax - ymin
    z_thresh = zmin + height * args.z_frac
    y_lo = ymin + length * 0.30
    y_hi = ymin + length * 0.72

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()

    picked = [v for v in bm.verts
              if v.co.z > z_thresh and y_lo < v.co.y < y_hi]
    print("dorsal tip verts:", len(picked), "of", len(bm.verts))
    print("z range:", round(zmin, 2), "->", round(zmax, 2), "threshold", round(z_thresh, 2))

    for _ in range(args.passes):
        bmesh.ops.smooth_vert(
            bm, verts=picked, factor=0.55,
            use_axis_x=True, use_axis_y=True, use_axis_z=True,
        )

    # pull the very tip down slightly so it reads as a blade, not a spike
    tip_cut = zmin + height * (args.z_frac + 0.10)
    for v in picked:
        if v.co.z > tip_cut:
            v.co.z -= (v.co.z - tip_cut) * args.pull

    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    print("dorsal smoothed")

bpy.ops.export_scene.gltf(filepath=args.dst, export_format="GLB",
                          export_apply=True, export_yup=True)
print("EXPORTED:", args.dst)

if args.render:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 40
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 620
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.world = bpy.data.worlds.new("W")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.05, 0.08, 1)

    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    center = (lo + hi) * 0.5
    radius = max(hi - lo) * 0.5

    cd = bpy.data.cameras.new("C")
    cd.lens = 50
    cam = bpy.data.objects.new("C", cd)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = center + Vector((1.0, 0.02, 0.08)).normalized() * (radius * 3.0)
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()

    for name, loc, energy in [("K", (0.9, 0.8, 0.9), 700), ("R", (-0.9, 0.6, -0.8), 800), ("F", (-0.7, 0.2, 0.6), 260)]:
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.size = 6
        lo_obj = bpy.data.objects.new(name, ld)
        lo_obj.location = center + Vector(loc) * radius * 1.8
        scene.collection.objects.link(lo_obj)
        lo_obj.rotation_euler = (center - lo_obj.location).to_track_quat("-Z", "Y").to_euler()

    scene.render.filepath = args.render
    bpy.ops.render.render(write_still=True)
    print("RENDERED:", args.render)
