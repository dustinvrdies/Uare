"""Quick smoke test for the 6 new geometry generators."""
import sys, math
sys.path.insert(0, 'C:/Users/quant/Downloads/UARE_general_zip_10of10_upgrade_final/Uare/.venv/Lib/site-packages')
import cadquery as cq

# --- inline the 6 new generators without importing the full run_cadquery.py ---

def _geo_oil_pan(cq, d):
    w   = max(float(d.get("width",  d.get("x", 420))), 1.0)
    dep = max(float(d.get("depth",  d.get("y", 200))), 1.0)
    h   = max(float(d.get("height", d.get("z",  85))), 1.0)
    wall = max(float(d.get("wall_thickness", 4.0)), 1.0)
    outer = cq.Workplane("XY").box(w, dep, h)
    inner = cq.Workplane("XY").box(w - wall*2, dep - wall*2, h - wall).translate((0, 0, wall*0.5))
    pan = outer.cut(inner)
    flange = cq.Workplane("XY").box(w, dep, wall * 1.5).translate((0, 0, h/2.0 - wall*0.25))
    pan = pan.union(flange)
    baffle_a = cq.Workplane("XY").box(wall * 1.5, dep - wall*4, h * 0.55).translate((-w*0.20, 0, -h*0.18))
    baffle_b = cq.Workplane("XY").box(wall * 1.5, dep - wall*4, h * 0.55).translate(( w*0.20, 0, -h*0.18))
    pan = pan.union(baffle_a).union(baffle_b)
    boss = cq.Workplane("XY").circle(wall*2.8).extrude(wall*2).translate((0, dep*0.35, -h/2.0 - wall*1.0))
    drain = cq.Workplane("XY").circle(wall*1.1).extrude(wall*3).translate((0, dep*0.35, -h/2.0 - wall*1.2))
    pan = pan.union(boss).cut(drain)
    return pan

def _geo_valve_cover(cq, d):
    w    = max(float(d.get("width",  d.get("x", 440))), 1.0)
    dep  = max(float(d.get("depth",  d.get("y", 195))), 1.0)
    h    = max(float(d.get("height", d.get("z",  62))), 1.0)
    wall = max(float(d.get("wall_thickness", 3.5)), 1.0)
    outer = cq.Workplane("XY").box(w, dep, h)
    inner = cq.Workplane("XY").box(w - wall*2, dep - wall*2, h - wall).translate((0, 0, -wall*0.5))
    cover = outer.cut(inner)
    rib_h = h * 0.32
    rib_t = wall * 1.2
    for i in range(5):
        rx = -w*0.38 + i*(w*0.19)
        rib = cq.Workplane("XY").box(rib_t, dep*0.82, rib_h).translate((rx, 0, h*0.5 - rib_h*0.5 + wall*0.5))
        cover = cover.union(rib)
    fill_boss = cq.Workplane("XY").circle(wall*4.5).extrude(wall*3.0).translate((w*0.32, dep*0.08, h/2.0 + wall*0.5))
    fill_hole = cq.Workplane("XY").circle(wall*2.8).extrude(wall*4.0).translate((w*0.32, dep*0.08, h/2.0 - wall*0.5))
    cover = cover.union(fill_boss).cut(fill_hole)
    flange = cq.Workplane("XY").box(w, dep, wall*1.4).translate((0, 0, -h/2.0 + wall*0.35))
    cover = cover.union(flange)
    return cover

def _geo_throttle_body(cq, d):
    bore_d = max(float(d.get("bore_diameter", d.get("diameter", 70))), 1.0)
    length = max(float(d.get("length",  d.get("z",  80))), 1.0)
    flange = max(float(d.get("flange_thickness", 12)), 1.0)
    wall   = max(float(d.get("wall_thickness",  6.0)), 1.0)
    body = cq.Workplane("XY").circle((bore_d/2.0) + wall).extrude(length)
    bore  = cq.Workplane("XY").circle(bore_d/2.0).extrude(length)
    body  = body.cut(bore)
    fl = cq.Workplane("XY").rect((bore_d + wall*4)*1.05, (bore_d + wall*4)*1.05).extrude(flange).translate((0, 0, -flange*0.5))
    body = body.union(fl)
    fl2 = cq.Workplane("XY").rect((bore_d + wall*4)*1.05, (bore_d + wall*4)*1.05).extrude(flange).translate((0, 0, length - flange*0.5))
    body = body.union(fl2)
    tps_boss = cq.Workplane("XZ").center(0, length*0.5).circle(wall*2.2).extrude(wall*2.4).translate((0, -(bore_d/2.0 + wall*2.0), 0))
    tps_hole = cq.Workplane("XZ").center(0, length*0.5).circle(wall*0.9).extrude(wall*2.6).translate((0, -(bore_d/2.0 + wall*2.2), 0))
    body = body.union(tps_boss).cut(tps_hole)
    shaft = cq.Workplane("YZ").center(0, length*0.5).circle(wall*0.55).extrude((bore_d + wall*2)*1.1).translate((-(bore_d/2.0 + wall)*1.05, 0, 0))
    return body.cut(shaft)

def _geo_intercooler(cq, d):
    w    = max(float(d.get("width",  d.get("x", 550))), 1.0)
    h    = max(float(d.get("height", d.get("z", 200))), 1.0)
    dep  = max(float(d.get("depth",  d.get("y",  80))), 1.0)
    wall = max(float(d.get("wall_thickness", 3.0)), 1.0)
    tank_w = max(w * 0.10, wall * 4)
    core = cq.Workplane("XY").box(w - tank_w*2, h, dep)
    ch_h = (h - wall*2) / 13.0
    for i in range(12):
        cy = -h/2.0 + wall + ch_h*(i + 0.5) + ch_h*0.1
        ch = cq.Workplane("XZ").center(0, cy).box(w - tank_w*2 - wall*2, dep - wall*2, ch_h*0.72)
        core = core.cut(ch)
    tank_l = cq.Workplane("XY").box(tank_w, h, dep).translate((-w/2.0 + tank_w/2.0, 0, 0))
    tank_r = cq.Workplane("XY").box(tank_w, h, dep).translate(( w/2.0 - tank_w/2.0, 0, 0))
    tank_cavity_l = cq.Workplane("XY").box(tank_w - wall*2, h - wall*2, dep - wall*2).translate((-w/2.0 + tank_w/2.0, 0, 0))
    tank_cavity_r = cq.Workplane("XY").box(tank_w - wall*2, h - wall*2, dep - wall*2).translate(( w/2.0 - tank_w/2.0, 0, 0))
    ic = core.union(tank_l).union(tank_r).cut(tank_cavity_l).cut(tank_cavity_r)
    noz_r = max(dep * 0.22, wall*3)
    for xsign, ysign in [(-1, -1), (1, 1)]:
        noz = cq.Workplane("XY").circle(noz_r).extrude(wall*4).translate((xsign*(w/2.0 + wall*1.5), ysign*(h*0.18), 0))
        noz_hole = cq.Workplane("XY").circle(noz_r - wall).extrude(wall*6).translate((xsign*(w/2.0 + wall*0.5), ysign*(h*0.18), 0))
        ic = ic.union(noz).cut(noz_hole)
    return ic

def _geo_radiator(cq, d):
    w    = max(float(d.get("width",  d.get("x", 640))), 1.0)
    h    = max(float(d.get("height", d.get("z", 480))), 1.0)
    dep  = max(float(d.get("depth",  d.get("y",  36))), 1.0)
    wall = max(float(d.get("wall_thickness", 2.0)), 1.0)
    tank_h = max(h * 0.12, wall * 6)
    core = cq.Workplane("XY").box(w, h - tank_h*2, dep)
    ch_h = (h - tank_h*2 - wall*2) / 17.0
    for i in range(16):
        cy = -(h - tank_h*2)/2.0 + wall + ch_h*(i + 0.5)
        ch = cq.Workplane("XZ").center(0, cy).box(w - wall*2, dep - wall*2, ch_h*0.65)
        core = core.cut(ch)
    tank_top = cq.Workplane("XY").box(w, tank_h, dep).translate((0,  (h - tank_h*2)/2.0 + tank_h/2.0, 0))
    tank_bot = cq.Workplane("XY").box(w, tank_h, dep).translate((0, -(h - tank_h*2)/2.0 - tank_h/2.0, 0))
    t_cav_top = cq.Workplane("XY").box(w - wall*2, tank_h - wall*2, dep - wall*2).translate((0,  (h - tank_h*2)/2.0 + tank_h/2.0, 0))
    t_cav_bot = cq.Workplane("XY").box(w - wall*2, tank_h - wall*2, dep - wall*2).translate((0, -(h - tank_h*2)/2.0 - tank_h/2.0, 0))
    rad = core.union(tank_top).union(tank_bot).cut(t_cav_top).cut(t_cav_bot)
    neck_r = max(dep * 0.38, wall*4)
    neck_in  = cq.Workplane("XZ").center(-w*0.35, (h - tank_h*2)/2.0 + tank_h*0.5).circle(neck_r).extrude(dep*0.7).translate((0, dep/2.0, 0))
    neck_in_hole = cq.Workplane("XZ").center(-w*0.35, (h - tank_h*2)/2.0 + tank_h*0.5).circle(neck_r - wall).extrude(dep).translate((0, dep/2.0 - wall, 0))
    neck_out = cq.Workplane("XZ").center( w*0.35, -(h - tank_h*2)/2.0 - tank_h*0.5).circle(neck_r).extrude(dep*0.7).translate((0, dep/2.0, 0))
    neck_out_hole = cq.Workplane("XZ").center( w*0.35, -(h - tank_h*2)/2.0 - tank_h*0.5).circle(neck_r - wall).extrude(dep).translate((0, dep/2.0 - wall, 0))
    rad = rad.union(neck_in).cut(neck_in_hole).union(neck_out).cut(neck_out_hole)
    return rad

def _geo_oil_filter(cq, d):
    od   = max(float(d.get("outer_diameter", d.get("diameter", 78))), 1.0)
    h    = max(float(d.get("height", d.get("z", 102))), 1.0)
    wall = max(float(d.get("wall_thickness", 2.5)), 1.0)
    thread_d = max(float(d.get("thread_diameter", 22)), 1.0)
    canister = cq.Workplane("XY").circle(od/2.0).extrude(h * 0.90)
    dome_cut = cq.Workplane("XY").circle(od/2.0 - wall).extrude(h*0.88).translate((0,0,wall))
    canister = canister.cut(dome_cut)
    base = cq.Workplane("XY").circle(od/2.0).extrude(h * 0.10).translate((0, 0, h*0.90))
    canister = canister.union(base)
    thread_boss = cq.Workplane("XY").circle(thread_d*0.65).extrude(h*0.12).translate((0, 0, h*0.90 - h*0.01))
    thread_hole = cq.Workplane("XY").circle(thread_d/2.0).extrude(h*0.16).translate((0, 0, h*0.87))
    canister = canister.union(thread_boss).cut(thread_hole)
    port_r = thread_d * 1.05
    for i in range(8):
        ang = (2*math.pi * i)/8.0
        px, py = math.cos(ang)*port_r, math.sin(ang)*port_r
        port = cq.Workplane("XY").center(px, py).circle(thread_d*0.18).extrude(h*0.16).translate((0,0,h*0.87))
        canister = canister.cut(port)
    for i in range(6):
        ang = (math.pi * i) / 6.0
        hx = math.cos(ang) * (od * 0.98 / 2.0 + wall * 0.3)
        hy = math.sin(ang) * (od * 0.98 / 2.0 + wall * 0.3)
        flat_cut = cq.Workplane("XY").center(hx, hy).box(wall * 1.4, od, h * 0.80).translate((0, 0, h * 0.45))
        canister = canister.cut(flat_cut)
    return canister

tests = {
    'oil_pan':     {'width':420,'depth':200,'height':85},
    'valve_cover': {'width':440,'depth':195,'height':62},
    'throttle_body':{'bore_diameter':70,'length':80},
    'intercooler': {'width':550,'height':200,'depth':80},
    'radiator':    {'width':640,'height':480,'depth':36},
    'oil_filter':  {'outer_diameter':78,'height':102},
}

fns = {
    'oil_pan': _geo_oil_pan,
    'valve_cover': _geo_valve_cover,
    'throttle_body': _geo_throttle_body,
    'intercooler': _geo_intercooler,
    'radiator': _geo_radiator,
    'oil_filter': _geo_oil_filter,
}

for name, dims in tests.items():
    try:
        s = fns[name](cq, dims)
        bb = s.val().BoundingBox()
        vol = s.val().Volume()
        print(f"OK  {name}: bbox={bb.xlen:.0f}x{bb.ylen:.0f}x{bb.zlen:.0f}mm vol={vol/1000:.0f}cm3")
    except Exception as e:
        print(f"ERR {name}: {e}")
