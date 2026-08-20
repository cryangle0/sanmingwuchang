# -*- coding: utf-8 -*-
"""百眼迷城 地图工程数据模型 v2 (审计返工版)
修复: P0-01安全圆/P0-02三庭缩放/P0-03墙体一致NavGraph/P0-04连续无岔链/
P0-05出生30容量/P0-06遭遇缩放bug/P0-07完整工程数据/P1-1移动圈心/P1-3商店扑空/
P1-4路线独立性/P1-5放大图/P1-6高台Z轴。
几何原则: 道路走廊对墙群做布尔差集(路从废墟中开凿), 墙体/路网/LOS/寻路同源。
种子20260718。输出: JSON工程数据+CSV+验证报告+图册。
"""
import math, os, json, csv, random
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MPoly, Circle as MCirc, Rectangle as MRect
from matplotlib.lines import Line2D
from shapely.geometry import Polygon, LineString, Point, MultiPolygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

random.seed(20260718)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "地图输出"); os.makedirs(OUT, exist_ok=True)
CX, CY, S = 908.0, 810.0, 0.533
def W(p): return ((p[0]-CX)*S, (CY-p[1])*S)
def dist_m(a,b): return math.hypot(a[0]-b[0], a[1]-b[1]) * S
M2PX = 1.0/S

# ============ 原始几何(px, 与v1同源) ============
ROADS = [
 [(250,420),(430,420),(510,510),(700,510),(790,620),(1000,620),(1090,520),(1260,520),(1370,435),(1540,430)],
 [(230,865),(380,865),(475,765),(620,765),(720,850),(890,850),(970,760),(1160,760),(1260,850),(1440,850),(1545,760)],
 [(285,1150),(455,1150),(555,1050),(710,1050),(815,1160),(1030,1160),(1130,1070),(1290,1070),(1410,1170),(1545,1170)],
 [(430,420),(380,600),(475,765)],[(790,620),(720,850),(710,1050)],
 [(1090,520),(1160,760),(1130,1070)],[(1370,435),(1440,850),(1410,1170)],
 [(510,510),(610,385),(825,375),(1000,450),(1260,520)],
 [(620,765),(775,700),(970,760)],[(890,850),(815,960),(815,1160)],
 [(1160,760),(1305,675),(1440,850)],
]
LANES = [
 [(230,865),(315,700),(380,600),(570,600),(620,765)],
 [(475,765),(430,940),(555,1050)],[(700,510),(700,350),(825,375)],
 [(1000,620),(1000,450),(1090,520)],[(1260,520),(1305,675),(1420,610),(1540,430)],
 [(1440,850),(1510,970),(1545,1170)],[(710,1050),(625,1250),(700,1400)],
 [(1030,1160),(1030,1325),(1125,1380)],
]
SECRETS = [
 [(315,700),(500,670),(700,510)],[(970,760),(1050,850),(1130,1070)],
 [(1260,850),(1350,950),(1510,970)],[(555,1050),(650,940),(815,960)],
]
GATES_PX = [(790,600),(1140,540),(953,866),(1207,1086)]
COURTS_RAW = {
 "B1_惊蛰庭": dict(hex=[(835,560),(960,490),(1085,560),(1060,690),(925,715),(820,650)],
      center=(950,605), attach=[(790,620),(1090,520),(970,760)]),
 "B2_玄冥庭": dict(hex=[(780,880),(910,805),(1025,875),(995,1010),(850,1035),(750,965)],
      center=(885,920), attach=[(720,850),(1050,850),(815,960)]),
 "B3_焚天庭": dict(hex=[(1080,880),(1210,810),(1330,885),(1300,1015),(1155,1035),(1055,965)],
      center=(1190,920), attach=[(1050,850),(1350,950),(1130,1070)]),
}
COURT_SCALE = 0.58  # P0-02: 154.2m*0.58=89.4m<=90m
PIGS = [(335,445),(555,720),(815,420),(1375,540),(1510,880),(340,1175),(635,1310),
        (1145,1290),(1475,1200),(245,700),(1600,680),(1005,1395)]
DKS  = [(1195,380),(1450,610),(480,950),(720,1120),(1285,1100)]
SHOPS= [(437,411),(682,477),(1087,431),(1557,547),(392,797),(677,917),(1342,917),(1497,1017),
        (447,1097),(797,1037),(1052,1097),(1382,1155),(300,540),(1050,745),(1590,760),(880,1120)]
SPAWNS=[(220,390),(305,635),(545,230),(685,270),(955,260),(1450,290),(1580,600),(1580,890),
        (1540,1240),(1250,1360),(930,1370),(520,1345),(235,1210),(200,980),(1250,250)]  # P0-05: +1=15区
ELITES=[(610,600),(1000,450),(815,1035),(1305,675)]
ROCKS =[(468,470),(633,540),(766,688),(1048,690),(1212,655),(1423,700),(487,910),(658,960),
        (782,1080),(1083,970),(1342,1025),(1473,1150),(612,1200),
        (355,470),(840,445),(1390,565),(1490,905),(660,1290),(1120,1265),(300,700),
        (900,540),(830,960),(1265,882),(240,890)]
ZONES = {
 "断金坊": [(150,280),(650,195),(760,570),(475,755),(145,690)],
 "蛛丝峡": [(760,200),(1210,185),(1365,570),(960,685),(725,545)],
 "龙脊渊": [(1220,190),(1645,360),(1640,720),(1375,745),(1335,555)],
 "百足城": [(145,730),(475,770),(735,1015),(475,1220),(175,1110)],
 "烬水市": [(1330,760),(1650,735),(1655,1010),(1560,1265),(1245,1215),(1170,970)],
 "迷魂田": [(470,1235),(760,1035),(1175,990),(1240,1220),(1125,1380),(700,1400)],
}
WALLS_RAW = [
 [(255,305),(435,275),(485,345),(420,385),(270,370)],[(505,275),(625,255),(665,320),(600,365),(500,340)],
 [(275,530),(400,500),(445,560),(395,625),(270,610)],[(480,585),(590,560),(650,620),(595,685),(475,665)],
 [(720,245),(840,225),(905,290),(865,350),(740,340)],[(965,270),(1080,230),(1155,310),(1095,375),(980,350)],
 [(1220,275),(1350,290),(1400,370),(1330,425),(1210,390)],[(1450,350),(1560,380),(1580,485),(1495,505),(1435,430)],
 [(250,745),(345,740),(395,810),(350,855),(245,830)],[(495,840),(610,820),(670,885),(610,940),(490,920)],
 [(770,745),(875,720),(930,780),(880,830),(765,815)],[(1010,815),(1110,805),(1175,875),(1100,930),(1005,900)],
 [(1240,760),(1350,735),(1410,805),(1360,865),(1250,845)],[(1490,650),(1580,660),(1610,740),(1540,790),(1475,750)],
 [(255,995),(375,980),(430,1045),(370,1105),(255,1080)],[(470,1190),(570,1160),(630,1225),(575,1285),(465,1260)],
 [(730,1230),(840,1205),(900,1275),(840,1335),(730,1305)],[(1000,1240),(1110,1225),(1180,1290),(1120,1350),(1005,1330)],
 [(1280,1220),(1400,1200),(1485,1260),(1420,1325),(1300,1300)],[(1450,1010),(1575,1000),(1610,1080),(1550,1130),(1450,1100)],
]
BOUNDARY = [(120,260),(270,185),(530,200),(700,165),(980,205),(1210,170),(1475,215),(1660,350),
 (1690,600),(1630,790),(1695,1010),(1600,1270),(1390,1415),(1150,1385),(930,1450),(690,1405),
 (470,1450),(245,1320),(155,1120),(205,905),(135,700)]
HIGHLANDS = [  # P1-6: 高台(z米), 坡道两端
 dict(name="龙脊东台", poly=[(1490,430),(1585,455),(1600,540),(1520,560),(1470,505)], z=4.0,
      ramps=[[(1500,545),(1470,595)],[(1585,470),(1610,430)]], overlook=45),
 dict(name="龙脊南台", poly=[(1470,690),(1560,700),(1585,760),(1520,800),(1460,760)], z=3.5,
      ramps=[[(1470,750),(1440,790)]], overlook=40),
 dict(name="蛛丝观星台", poly=[(850,300),(930,285),(965,340),(915,380),(855,360)], z=4.0,
      ramps=[[(905,375),(890,420)]], overlook=45),
]

# ============ 三庭缩放(P0-02) ============
COURTS = {}
for name,c in COURTS_RAW.items():
    ctr = c["center"]
    hexp = [(ctr[0]+(v[0]-ctr[0])*COURT_SCALE, ctr[1]+(v[1]-ctr[1])*COURT_SCALE) for v in c["hex"]]
    poly = Polygon(hexp)
    gates=[]
    for att in c["attach"]:
        # 门=缩放后六边形边界上朝attach方向的点
        line = LineString([ctr, att])
        inter = line.intersection(poly.exterior)
        g = (inter.x, inter.y) if inter.geom_type=="Point" else (list(inter.geoms)[0].x, list(inter.geoms)[0].y)
        gates.append((g, att))
    # 庭内: 终局双商位(r=27m, 夹角95度), 6复活位(r=38m), 2庭内伏石(r=30m避商位15m)
    def at(r_m, ang_deg):
        r = r_m*M2PX
        return (ctr[0]+r*math.cos(math.radians(ang_deg)), ctr[1]+r*math.sin(math.radians(ang_deg)))
    base = random.uniform(0,360)
    shops2 = [at(27, base), at(27, base+95)]
    revives = [at(38, base+30+i*60) for i in range(6)]
    crocks=[]
    for ang in (base+170, base+260):
        p = at(30, ang)
        if all(dist_m(p,s)>=15 for s in shops2): crocks.append(p)
    COURTS[name] = dict(hex=hexp, center=ctr, gates=gates, shops=shops2, revives=revives, rocks=crocks)

# ============ 建图 ============
nodes={}; edges=[]
def key(p): return (round(p[0],1),round(p[1],1))
def nid(p):
    k=key(p)
    if k not in nodes: nodes[k]=f"N{len(nodes):03d}"
    return nodes[k]
def add_path(pts, cls, w):
    for a,b in zip(pts,pts[1:]):
        if key(a)==key(b): continue
        edges.append([nid(a),nid(b),key(a),key(b),cls,w,dist_m(a,b)])
for p in ROADS: add_path(p,"MAIN",12)
for p in LANES: add_path(p,"SIDE",7)
for p in SECRETS: add_path(p,"RISK",4.5)
for name,c in COURTS.items():
    for g,att in c["gates"]:
        add_path([c["center"],g],"COURT",8); add_path([g,att],"COURT",8)
def attach_nearest(p, cls, w, k=1):
    cand=sorted(nodes.keys(), key=lambda kk:math.hypot(kk[0]-p[0],kk[1]-p[1]))
    for kk in cand[:k]: add_path([p,kk],cls,w)
road_keys=set(nodes.keys())
for p in PIGS: attach_nearest(p,"DEN",5,1)
for p in DKS: attach_nearest(p,"ARENA",8,3)
for p in ELITES: attach_nearest(p,"ARENA",8,2)
for p in SHOPS: attach_nearest(p,"SHOP",6,2)
for p in SPAWNS: attach_nearest(p,"SPAWNL",6,2)
for h in HIGHLANDS:
    top=(sum(v[0] for v in h["poly"])/len(h["poly"]), sum(v[1] for v in h["poly"])/len(h["poly"]))
    for rmp in h["ramps"]:
        add_path([top, rmp[0], rmp[1]],"RAMP",5)
    attach_nearest(h["ramps"][0][1],"SIDE",5,1)

# ============ P0-03: 墙体差集 -> 同源NavGraph (圆头端帽, 可重算) ============
WALLS=[]; wall_tree=None
def clip_walls():
    global WALLS, wall_tree
    corridors=[LineString([ka,kb]).buffer((w/2+1.0)*M2PX, cap_style=1)
               for a,b,ka,kb,cls,w,L in edges]
    corridor_u = unary_union(corridors)
    WALLS=[]
    for poly in WALLS_RAW:
        p = Polygon(poly).difference(corridor_u)
        wcls = "BOUND" if math.hypot(*(W((Polygon(poly).centroid.x,Polygon(poly).centroid.y))))>330 else "VAULT"
        hz = 6.0 if wcls=="BOUND" else 2.5
        geoms = list(p.geoms) if isinstance(p, MultiPolygon) else ([p] if not p.is_empty else [])
        for g in geoms:
            if g.area*S*S >= 40: WALLS.append((g, wcls, hz))
    wall_tree = STRtree([w[0] for w in WALLS])
clip_walls()
def edge_hits_wall(ka,kb):
    ls=LineString([ka,kb])
    for i in wall_tree.query(ls):
        if ls.intersects(WALLS[i][0]): return True
    return False
def edge_hits_bound(ka,kb):
    ls=LineString([ka,kb])
    for i in wall_tree.query(ls):
        if WALLS[i][1]=="BOUND" and ls.intersects(WALLS[i][0]): return True
    return False
def los_blocked(a,b):
    ls=LineString([a,b])
    for i in wall_tree.query(ls):
        if ls.intersects(WALLS[i][0]): return True
    return False

# ============ 邻接与寻路 ============
def rebuild_adj():
    global adjK
    adjK={}
    for a,b,ka,kb,cls,w,L in edges:
        adjK.setdefault(ka,[]).append((kb,L,cls)); adjK.setdefault(kb,[]).append((ka,L,cls))
rebuild_adj()
import heapq
def dijkstra(src):
    D={src:0.0}; pq=[(0.0,src)]
    while pq:
        d,u=heapq.heappop(pq)
        if d>D.get(u,1e18): continue
        for v,L,cls in adjK.get(u,[]):
            nd=d+L
            if nd<D.get(v,1e18): D[v]=nd; heapq.heappush(pq,(nd,v))
    return D
def route(a,b):
    D={a:0.0}; prev={}; pq=[(0.0,a)]
    while pq:
        d,u=heapq.heappop(pq)
        if u==b: break
        if d>D.get(u,1e18): continue
        for v,L,cls in adjK.get(u,[]):
            nd=d+L
            if nd<D.get(v,1e18): D[v]=nd; prev[v]=u; heapq.heappush(pq,(nd,v))
    if b not in prev and a!=b: return None
    seq=[b]
    while seq[-1]!=a: seq.append(prev[seq[-1]])
    return seq[::-1]
def node_of(p): return min(nodes.keys(), key=lambda k:math.hypot(k[0]-p[0],k[1]-p[1]))

# ============ P0-04: 连续无岔链审计与修复 ============
def decision_nodes():
    degc={}; special=set()
    for a,b,ka,kb,cls,w,L in edges:
        degc[ka]=degc.get(ka,0)+1; degc[kb]=degc.get(kb,0)+1
        if cls not in ("MAIN","SIDE"):
            special.add(ka); special.add(kb)
    return {k for k,d in degc.items() if d>=3} | special
def chain_audit():
    dec = decision_nodes()
    seen=set(); chains=[]
    emap={}
    for e in edges:
        if e[4] in ("MAIN","SIDE"):
            emap.setdefault(e[2],[]).append(e); emap.setdefault(e[3],[]).append(e)
    for e in edges:
        if e[4] not in ("MAIN","SIDE"): continue
        eid=id(e)
        if eid in seen: continue
        # 从该边向两端延伸至决策节点
        chain=[e]; seen.add(eid)
        for endsel in (0,1):
            cur = e[2] if endsel==0 else e[3]
            prev_e = e
            while cur not in dec:
                nxt=[x for x in emap.get(cur,[]) if id(x)!=id(prev_e)]
                if len(nxt)!=1: break
                ne=nxt[0]
                if id(ne) in seen: break
                seen.add(id(ne)); chain.append(ne)
                cur = ne[3] if ne[2]==cur else ne[2]
                prev_e=ne
        total=sum(x[6] for x in chain)
        ks=set()
        for x in chain: ks.add(x[2]); ks.add(x[3])
        ends=[k for k in ks if k in dec]
        chains.append((total, ends, chain))
    return [(t,ends,ch) for t,ends,ch in chains if t>60]
def split_edge_at(e, mid):
    """把边e在mid处切分为两条(保持类别宽度), 返回mid键"""
    edges.remove(e)
    add_path([e[2], mid], e[4], e[5]); add_path([mid, e[3]], e[4], e[5])
    return key(mid)
def fix_chains(max_iter=6):
    added=[]
    for it in range(max_iter):
        viol = chain_audit()
        if not viol: break
        changed=False
        for total,ends,chain in viol:
            acc=0
            for e in chain:
                if e not in edges: continue
                acc+=e[6]
                if acc>=55:
                    mid=((e[2][0]+e[3][0])/2,(e[2][1]+e[3][1])/2)
                    # 附近已有侧门则不重复加(20m)
                    if any(dist_m(mid,(m[1][0],m[1][1]))<20 for m in added): acc=0; continue
                    mk=split_edge_at(e, mid)   # ★关键: 切分原边, mid在链上
                    chain_keys={x[2] for x in chain}|{x[3] for x in chain}
                    cand=[k for k in nodes.keys() if k not in chain_keys and k!=mk
                          and 15 < dist_m(mk,k) <= 85 and not edge_hits_wall(mk,k)]
                    breach=[k for k in nodes.keys() if k not in chain_keys and k!=mk
                            and 15 < dist_m(mk,k) <= 110 and not edge_hits_bound(mk,k)]
                    if cand:
                        tgt=min(cand, key=lambda k:dist_m(mk,k))
                        add_path([mk,tgt],"SIDEDOOR",4.5); added.append(("SIDEDOOR",mk,tgt))
                    elif breach:  # 打穿可越障矮墙的可破坏墙洞(禁穿封界)
                        tgt=min(breach, key=lambda k:dist_m(mk,k))
                        add_path([mk,tgt],"BREACH",4); added.append(("BREACH",mk,tgt))
                    else:
                        dx=e[3][0]-e[2][0]; dy=e[3][1]-e[2][1]; dl=math.hypot(dx,dy) or 1
                        for ang in (90,-90,45,-45):
                            ca,sa=math.cos(math.radians(ang)),math.sin(math.radians(ang))
                            ux,uy=dx/dl,dy/dl
                            vx,vy=ux*ca-uy*sa, ux*sa+uy*ca
                            pk=(mk[0]+vx*(14*M2PX), mk[1]+vy*(14*M2PX))
                            if not edge_hits_wall(mk,pk):
                                add_path([mk,pk],"POCKET",4); added.append(("POCKET",mk,pk)); break
                    changed=True; acc=0  # 继续处理本链后续段
        rebuild_adj()
        if not changed: break
    return added, chain_audit()
sidedoors, chain_left = fix_chains(max_iter=14)
rebuild_adj()
clip_walls()  # ★新边(侧门/龛)纳入走廊, 重切墙体保持同源
bad_edges=[(a,b) for a,b,ka,kb,cls,w,L in edges if edge_hits_wall(ka,kb)]

# ============ P0-05: 30微出生位 (强健生成: 每区必得2个) ============
bnd_poly=Polygon(BOUNDARY)
SPAWN_MICRO=[]
POI_PTS=PIGS+DKS+ELITES+SHOPS+[c["center"] for c in COURTS.values()]
for zi,zp in enumerate(SPAWNS):
    n0 = node_of(zp)
    got=[]
    # 16方向×6半径穷举, 约束逐级放宽(半径优先近)
    cands=[]
    for ai in range(16):
        ang=ai*math.pi/8
        for rm in (26,34,42,50,58,66):
            p=(zp[0]+math.cos(ang)*rm*M2PX, zp[1]+math.sin(ang)*rm*M2PX)
            if not bnd_poly.contains(Point(p)): continue
            if any(w[0].contains(Point(p)) for w in WALLS): continue
            dpoi=min(dist_m(p,q) for q in POI_PTS)
            drock=min(dist_m(p,r) for r in ROCKS)
            cands.append((dpoi, drock, p))
    cands.sort(key=lambda c:-c[0])
    def try_fill(poi_min, need_blocked):
        for dpoi,drock,p in cands:
            if len(got)>=2: break
            if dpoi<poi_min or drock<6: continue
            if got:
                d0=dist_m(p,got[0]["pos"])
                blocked=los_blocked(p,got[0]["pos"])
                if need_blocked and not blocked: continue          # 第一优先: 墙体遮挡对
                if not blocked and d0<50: continue                  # 无遮挡必须>=50m
                if d0<18: continue
            # ★跨区全局约束: 与任何已定微位<40m且无遮挡 -> 拒绝(防相邻区微位互相贴脸)
            clash=False
            for om in SPAWN_MICRO:
                dg=dist_m(p,om["pos"])
                if dg<40 and not los_blocked(p,om["pos"]): clash=True; break
                if dg<18: clash=True; break
            if clash: continue
            face=math.degrees(math.atan2(-(n0[1]-p[1]), n0[0]-p[0]))
            got.append(dict(zone=f"R{zi+1:02d}", id=f"R{zi+1:02d}_{len(got)+1}", pos=p,
                            facing=round(face,1), losblk=bool(got and los_blocked(p,got[0]["pos"]))))
    try_fill(30, True)          # 优先墙隔对
    try_fill(30, False)         # 次选>=50m开阔对
    try_fill(22, False)         # 兜底放宽POI(仍守50m/遮挡规则)
    SPAWN_MICRO += got
spawn_capacity_ok = len(SPAWN_MICRO)>=30

# ============ P0-07: 完整工程数据生成 ============
# 商店48微点
SHOP_MICRO=[]
for si,sp in enumerate(SHOPS):
    n0=node_of(sp)
    ang0=math.atan2(n0[1]-sp[1], n0[0]-sp[0])
    for mi,da in enumerate((0, 2.0, 4.2)):
        r = 0 if mi==0 else 10*M2PX
        p=(sp[0]+math.cos(ang0+da)*r, sp[1]+math.sin(ang0+da)*r)
        SHOP_MICRO.append(dict(macro=f"S{si+1:02d}", id=f"S{si+1:02d}_{mi+1}", pos=p))
# 怪物槽: 圈层带(米): 内<130, 中130-260, 外>260
def ring_of(k):
    r=math.hypot(*W(k))
    return "内" if r<130 else ("中" if r<260 else "外")
band_nodes={"内":[],"中":[],"外":[]}
court_polys=[Polygon(c["hex"]) for c in COURTS.values()]
for k in nodes.keys():
    if any(cp.buffer(10*M2PX).contains(Point(k)) for cp in court_polys): continue
    band_nodes[ring_of(k)].append(k)
MON_SLOTS=[]; NESTS=[]
def gen_slots(kind, counts, nest_size=(2,3)):
    idx=0
    for band,cnt in counts.items():
        pool=[k for k in band_nodes[band]]
        random.shuffle(pool)
        left=cnt; pi=0
        while left>0 and pi<len(pool):
            base=pool[pi]; pi+=1
            if any(dist_m(base,sp)<35 for sp in SPAWNS): continue
            gsz=min(left, random.randint(*nest_size))
            nest_id=f"{kind}_{band}_{len(NESTS):03d}"
            slots=[]
            for gi in range(gsz):
                ang=random.uniform(0,2*math.pi); rm=random.uniform(6,15)
                p=(base[0]+math.cos(ang)*rm*M2PX, base[1]+math.sin(ang)*rm*M2PX)
                mig=[]
                for _ in range(3):
                    a2=random.uniform(0,2*math.pi); r2=random.uniform(30,55)
                    mig.append([round(base[0]+math.cos(a2)*r2*M2PX,1), round(base[1]+math.sin(a2)*r2*M2PX,1)])
                sid=f"{kind}{idx:03d}"; idx+=1
                slots.append(sid)
                MON_SLOTS.append(dict(id=sid, kind=kind, band=band, nest=nest_id,
                                      pos=[round(p[0],1),round(p[1],1)], migration=mig))
            NESTS.append(dict(id=nest_id, kind=kind, band=band, base=[round(base[0],1),round(base[1],1)], slots=slots))
            left-=gsz
gen_slots("MEL", {"外":30,"中":18,"内":10})
gen_slots("RNG", {"外":20,"中":12,"内":6})
gen_slots("FLY", {"中":8,"外":4}, nest_size=(1,2))
nest_links=[]
for i,n1 in enumerate(NESTS):
    for n2 in NESTS[i+1:]:
        if dist_m(tuple(n1["base"]),tuple(n2["base"]))<=30:
            nest_links.append([n1["id"],n2["id"]])
# 宝箱/空投落点池: 45m网格
CHEST_POOL=[]
bnd=Polygon(BOUNDARY)
step=45*M2PX
x=120
while x<1700:
    y=165
    while y<1460:
        p=(x,y)
        if bnd.contains(Point(p)) and not any(cp.buffer(20*M2PX).contains(Point(p)) for cp in court_polys) \
           and all(dist_m(p,s)>=30 for s in SHOPS) and all(dist_m(p,d)>=20 for d in PIGS) \
           and not any(wl[0].contains(Point(p)) for wl in WALLS):
            CHEST_POOL.append([round(p[0],1),round(p[1],1)])
        y+=step
    x+=step

# ============ 天劫时间轴(P0-01方案A + P1-1移动圈心) ============
# 地图等效跨度=840m(不变); 初始安全圆=直径1040m(半径520>512.2覆盖全图)
TIANJIE = dict(
  note="地图等效跨度840m与安全圆直径为两个独立参数(P0-01方案A)",
  initial_diameter=1040,
  phases=[  # (开始min, 结束min, 半径m, 圈心)
    dict(t0=0.0,  t1=5.0,  r=520, center="origin"),
    dict(t0=5.0,  t1=None, r=320, center="origin", window_candidates=[90,120,150]),
    dict(t0=10.0, t1=None, r=180, center="origin", window_candidates=[90,120,150]),
    dict(t0=15.0, t1=None, r=90,  center="court",  window_candidates=[90,120,150]),
    dict(t0=18.0, t1=None, r=60,  center="court",  window_candidates=[60,90]),
    dict(t0=19.0, t1=20.0, r=0,   center="court",  note="终局例外, 不作空间验收"),
  ])

# ============ 验证 ============
P50V, MINV = 4.25, 3.0
rep=["百眼迷城 v2 地图L2验证报告 (墙体一致NavGraph) 种子20260718",
     f"节点{len(nodes)} 边{len(edges)} 墙块{len(WALLS)}(差集后) 比例尺1px={S}m"]
def check(name, ok, detail): rep.append(("PASS " if ok else "FAIL ")+name+" | "+detail)

# V0 安全圆覆盖
dmax=max(math.hypot(*W(p)) for p in BOUNDARY)
check("V0 初始安全圆覆盖全图", TIANJIE["initial_diameter"]/2>=dmax,
      f"边界最远{dmax:.1f}m <= 半径{TIANJIE['initial_diameter']/2}m; 等效跨度840m为独立参数")
# V0b 三庭尺寸
for name,c in COURTS.items():
    dia=max(dist_m(a,b) for a in c["hex"] for b in c["hex"])
    check(f"V0b {name}外接直径<=90m", dia<=90.0, f"{dia:.1f}m (缩放系数{COURT_SCALE}); 终局120m圈可容")
    dshop=dist_m(c["shops"][0],c["shops"][1])
    dboss=min(dist_m(s,c["center"]) for s in c["shops"])
    rockok=all(dist_m(r,s)>=6 for r in c["rocks"] for s in c["shops"])
    check(f"V0c {name}终局商位", 35<=dshop<=45 and dboss>=25 and rockok,
          f"商距{dshop:.0f}m 离BOSS{dboss:.0f}m 6m无伏石={rockok} 复活位6个@38m环")
# V10 墙体一致性
check("V10 边×墙相交=0(同源几何)", len(bad_edges)==0, f"违例边{len(bad_edges)} (v1为58)")
# V1 连通
D0=dijkstra(node_of(SPAWNS[0]))
unreach=[k for k in nodes.keys() if k not in D0]
check("V1 全图连通", len(unreach)==0, f"孤立节点{len(unreach)}")
# V2 出生->POI
basic_poi=[node_of(p) for p in PIGS+SHOPS+ELITES]
res=[]
for sm in SPAWN_MICRO:
    D=dijkstra(node_of(sm["pos"]))
    res.append(min((D.get(pn,1e18) for pn in basic_poi))/P50V)
res.sort()
check("V2 微出生->最近基础POI P50<=45s", res[len(res)//2]<=45,
      f"P50={res[len(res)//2]:.0f}s P90={res[int(len(res)*.9)]:.0f}s (30微位)")
# V-SP 出生容量与互视
pairs_bad=0; cross_bad=0
for i in range(len(SPAWN_MICRO)):
    for j in range(i+1,len(SPAWN_MICRO)):
        a,b=SPAWN_MICRO[i],SPAWN_MICRO[j]
        d=dist_m(a["pos"],b["pos"])
        if d<40 and not los_blocked(a["pos"],b["pos"]):
            if a["zone"]==b["zone"]: pairs_bad+=1
            else: cross_bad+=1
check("V-SP 出生容量30+全局微位互不直视(<40m)", spawn_capacity_ok and pairs_bad==0 and cross_bad==0,
      f"微位{len(SPAWN_MICRO)}/30 同区互视{pairs_bad} 跨区互视{cross_bad} (15宏区×2)")
# V3 商店(P1-3: 加权分布+扑空率+P90)
shop_nodes=[node_of(p) for p in SHOPS]
allD={sn:dijkstra(sn) for sn in set(shop_nodes)}
popw={}
for k in nodes.keys():
    dmin=min(dist_m(k,q) for q in PIGS+ELITES)
    popw[k]=1.0/(1.0+dmin/100)
def wpct(vals_w, q):
    sw=sum(w for v,w in vals_w); acc=0
    for v,w in sorted(vals_w):
        acc+=w
        if acc>=q*sw: return v
    return vals_w[-1][0]
def legal4():
    for _ in range(400):
        pick=random.sample(range(len(SHOPS)),4)
        pts=[SHOPS[i] for i in pick]
        if all(dist_m(a,b)>=100 for i,a in enumerate(pts) for b in pts[i+1:]): return [node_of(p) for p in pts]
    return [node_of(SHOPS[i]) for i in random.sample(range(len(SHOPS)),4)]
t50s=[]; t90s=[]; miss=[]
for _ in range(120):
    act=legal4()
    vw=[(min(allD[a].get(k,1e18) for a in act)/P50V, popw[k]) for k in nodes.keys()]
    t50s.append(wpct(vw,0.5)); t90s.append(wpct(vw,0.9))
    m=0; tot=0
    for k,w in popw.items():
        tt=min(allD[a].get(k,1e18) for a in act)/P50V
        remain=random.uniform(0,180)
        tot+=w
        if tt>remain: m+=w
    miss.append(m/tot)
t50s.sort(); t90s.sort(); miss.sort()
check("V3a 土/鞋加权P50<=60s + 扑空率", t50s[len(t50s)//2]<=60,
      f"加权P50={t50s[len(t50s)//2]:.0f}s P90={t90s[len(t90s)//2]:.0f}s 随机启程扑空率P50={miss[len(miss)//2]*100:.0f}%")
tb_eq=[]; tb_w=[]
for i,sn in enumerate([node_of(p) for p in SHOPS]):
    ts=sorted(allD[sn].get(k,1e18)/P50V for k in nodes.keys())
    if ts[len(ts)//2]<=90: tb_eq.append(f"S{i+1:02d}")
    vw=[(allD[sn].get(k,1e18)/P50V, popw[k]) for k in nodes.keys()]
    if wpct(vw,0.5)<=90: tb_w.append(f"S{i+1:02d}")
check("V3b 太白合规宏区>=4(等权口径,与v1同标准)", len(tb_eq)>=4,
      f"等权合规{len(tb_eq)}: {tb_eq} | 加权(刷野人口)口径合规{len(tb_w)}: {tb_w}"
      f" — 加权口径更严, 供L3参考, 不作为通过依据也不隐藏")
# V4 缩圈逃生(P1-1: 移动圈心×3庭×窗口矩阵)
world_nodes={k:W(k) for k in nodes.keys()}
def esc_need(r_old, c_old, r_new, c_new, win):
    inside=[k for k,(x,y) in world_nodes.items() if math.hypot(x-c_new[0],y-c_new[1])<=r_new]
    if not inside: return 99
    need=0
    for k,(x,y) in world_nodes.items():
        if math.hypot(x-c_old[0],y-c_old[1])<=r_old and math.hypot(x-c_new[0],y-c_new[1])>r_new:
            D=dijkstra(k)
            d=min((D.get(i,1e18) for i in inside), default=1e18)
            need=max(need, d/win)
    return need
origin=(0,0)
WINS=(90,120,150,180)
mat=["V4 缩圈逃生矩阵(需求m/s, 限1.8=0.6x最低移速; 五级半径阶梯+圈心三段插值; 全窗口候选测试):",
     "  半径阶梯(候选): 520→320→220→140→90→60→0; 圈心: 前两缩原点, 220→140移1/3, 140→90移至庭, 之后庭心"]
ok_all=True
def lerp(a,b,t): return (a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t)
row=[esc_need(520,origin,320,origin,wn) for wn in WINS]
mat.append("  520→320(原点): " + " ".join(f"{wn}s={v:.2f}{'✓' if v<=1.8 else '✗'}" for wn,v in zip(WINS,row)))
if min(row)>1.8: ok_all=False
row=[esc_need(320,origin,220,origin,wn) for wn in WINS]
mat.append("  320→220(原点): " + " ".join(f"{wn}s={v:.2f}{'✓' if v<=1.8 else '✗'}" for wn,v in zip(WINS,row)))
if min(row)>1.8: ok_all=False
for cname,c in COURTS.items():
    cw=W(c["center"]); c13=lerp(origin,cw,1/3)
    rows=[("220→140(心1/3,"+cname[:2]+")", [esc_need(220,origin,140,c13,wn) for wn in WINS], WINS),
          ("140→90(→庭心,"+cname[:2]+")",  [esc_need(140,c13,90,cw,wn) for wn in WINS], WINS),
          ("90→60(庭心,"+cname[:2]+")",     [esc_need(90,cw,60,cw,wn) for wn in (60,90)], (60,90))]
    for lab,row,wins in rows:
        mat.append(f"  {lab}: " + " ".join(f"{wn}s={v:.2f}{'✓' if v<=1.8 else '✗'}" for wn,v in zip(wins,row)))
        if min(row)>1.8: ok_all=False
rep.extend(mat)
check("V4 各阶段存在<=1.8m/s的合法窗口(五级阶梯×3庭)", ok_all,
      "半径阶梯与窗口均为候选值待L3, 不写定值; 矩阵如实给出全部✓/✗")
# V5伏石 V6出生POI间距(微位已验) V7路线数
bad5=sum(1 for i,a in enumerate(ROCKS) for b in ROCKS[i+1:] if dist_m(a,b)<18)
check("V5 伏石间距>=18m", bad5==0, f"违例{bad5}")
deg={}
for a,b,ka,kb,cls,w,L in edges:
    deg[ka]=deg.get(ka,0)+1; deg[kb]=deg.get(kb,0)+1
# V12 路线独立性(P1-4): 多方向超源, 3条边不相交路径(近似最大流)
def disjoint_routes(p, need):
    tgt=node_of(p)
    # 超源=按方位角均布挑6个远端节点(>=250m), 模拟"从不同方向接近"
    far_nodes=[]
    cand=[(k, math.atan2(W(k)[1]-W(tgt)[1], W(k)[0]-W(tgt)[0]), dist_m(k,tgt))
          for k in nodes.keys() if dist_m(k,tgt)>=250]
    for si in range(6):
        a0=-math.pi + si*math.pi/3
        sect=[c for c in cand if a0<=c[1]<a0+math.pi/3]
        if sect: far_nodes.append(max(sect,key=lambda c:c[2])[0])
    if not far_nodes: return 0
    banned=set(); found=0
    for _ in range(need):
        D={f:0.0 for f in far_nodes}; prev={}; pq=[(0.0,f) for f in far_nodes]
        heapq.heapify(pq)
        while pq:
            d,u=heapq.heappop(pq)
            if u==tgt: break
            if d>D.get(u,1e18): continue
            for v,Lx,cls in adjK.get(u,[]):
                ek=tuple(sorted((u,v)))
                if ek in banned: continue
                nd=d+Lx
                if nd<D.get(v,1e18): D[v]=nd; prev[v]=u; heapq.heappush(pq,(nd,v))
        if tgt not in prev: break
        found+=1
        cur=tgt
        while cur in prev:
            pv=prev[cur]; banned.add(tuple(sorted((cur,pv)))); cur=pv
    return found
ind_fail=[]
for i,p in enumerate(DKS):
    fr=disjoint_routes(p,3)
    if fr<3: ind_fail.append(f"DK{i+1}={fr}")
for cname,c in COURTS.items():
    fr=disjoint_routes(c["center"],3)
    if fr<3: ind_fail.append(f"{cname}={fr}")
check("V12 龙宫/庭 3条边不相交独立路线", len(ind_fail)==0, ";".join(ind_fail) or "全部>=3")
# V8/V11 连续无岔链
check("V11 连续无岔链<=60m(决策节点法)", len(chain_left)==0,
      f"修复后剩余违规链{len(chain_left)} " +
      "; ".join(f"{t:.0f}m@{W(ends[0]) if ends else '?'}" for t,ends,ch in chain_left[:5]) +
      f" | 新增侧门/掩体龛{len(sidedoors)}处")
# V9 遭遇(P0-06修正: m/s恒定, 半径按scale, NavGraph+LOS)
POI_ALL=PIGS+DKS+ELITES+SHOPS+[c["center"] for c in COURTS.values()]
poi_keys=[node_of(p) for p in POI_ALL]
def encounter_sim(scale, trials=12):
    firsts=[]; gaps_all=[]
    px_speed = P50V/(S*scale)  # P0-06: 物理速度恒定m/s
    local_r_px = 280/(S*scale)
    for t in range(trials):
        # P0-05口径: 15区×2微位=30, 每微位唯一占用; ★起点=真实微位坐标(不吸附节点)
        slots=[(m["zone"], m["pos"]) for m in SPAWN_MICRO]
        random.shuffle(slots)
        starts=[s[1] for s in slots[:30]]
        picks=[node_of(p) for p in starts]
        def local_t(fromk):
            c=[p for p in poi_keys if 10<math.hypot(p[0]-fromk[0],p[1]-fromk[1])<=local_r_px]
            return c or [min(poi_keys,key=lambda p:math.hypot(p[0]-fromk[0],p[1]-fromk[1]))]
        plans=[]; zone_dir={}
        for i in range(30):
            cand=local_t(picks[i])
            z=slots[i][0] if i<len(slots) else None
            # 同区双人初始目标分流>=120度(审计P0-05"路线分流"要求)
            if z in zone_dir:
                a0=zone_dir[z]
                far=[p for p in cand
                     if abs((math.atan2(p[1]-picks[i][1],p[0]-picks[i][0])-a0+math.pi)%(2*math.pi)-math.pi)>=math.radians(120)]
                tgt=random.choice(far) if far else min(cand,key=lambda p:-math.hypot(p[0]-picks[i][0],p[1]-picks[i][1]))
            else:
                tgt=random.choice(cand)
                if z is not None:
                    zone_dir[z]=math.atan2(tgt[1]-picks[i][1], tgt[0]-picks[i][0])
            r=route(picks[i], tgt) or [picks[i]]
            seq=[key(starts[i])]+r if key(starts[i])!=r[0] else r  # 从真实微位走到路网
            plans.append({"seq":seq,"i":0,"prog":0.0,"pos":seq[0],"dwell":0.0})
        together=set(); first={i:None for i in range(30)}; last={i:0.0 for i in range(30)}; gaps=[]
        DT=2.0
        for si in range(150):
            tnow=si*DT
            for pl in plans:
                if pl["dwell"]>0: pl["dwell"]-=DT
                else:
                    mv=px_speed*DT
                    while mv>0 and pl["i"]<len(pl["seq"])-1:
                        a=pl["seq"][pl["i"]]; b=pl["seq"][pl["i"]+1]
                        segL=math.hypot(b[0]-a[0],b[1]-a[1]); rem=segL-pl["prog"]
                        if mv>=rem: pl["i"]+=1; pl["prog"]=0; mv-=rem
                        else: pl["prog"]+=mv; mv=0
                    if pl["i"]>=len(pl["seq"])-1:
                        pl["dwell"]=random.uniform(20,40)
                        r=route(pl["seq"][-1], random.choice(local_t(pl["seq"][-1]))) or [pl["seq"][-1]]
                        pl.update({"seq":r,"i":0,"prog":0.0})
                a=pl["seq"][pl["i"]]; b=pl["seq"][min(pl["i"]+1,len(pl["seq"])-1)]
                segL=max(1e-6,math.hypot(b[0]-a[0],b[1]-a[1])); tt=pl["prog"]/segL
                pl["pos"]=(a[0]+(b[0]-a[0])*tt, a[1]+(b[1]-a[1])*tt)
            for i in range(30):
                for j in range(i+1,30):
                    dx=(plans[i]["pos"][0]-plans[j]["pos"][0])*S*scale
                    dy=(plans[i]["pos"][1]-plans[j]["pos"][1])*S*scale
                    d2=dx*dx+dy*dy; kp=(i,j)
                    if d2<=900 and kp not in together:
                        if los_blocked(plans[i]["pos"],plans[j]["pos"]): continue
                        together.add(kp)
                        for x in (i,j):
                            if first[x] is None: first[x]=tnow
                            else: gaps.append(tnow-last[x])
                            last[x]=tnow
                    elif d2>=3600 and kp in together: together.discard(kp)
        for i in range(30): firsts.append(first[i] if first[i] is not None else 300.0)
        gaps_all+=gaps
    firsts.sort(); gaps_all.sort()
    def pc(arr,q): return arr[min(len(arr)-1,int(len(arr)*q))] if arr else 300
    return dict(first_p10=pc(firsts,.1), first_p50=pc(firsts,.5), first_p90=pc(firsts,.9),
                gap_p50=pc(gaps_all,.5) if gaps_all else 300)
enc={}
for scale,tag in ((760/840,"760"),(1.0,"840"),(960/840,"960")):
    enc[tag]=encounter_sim(scale)
e840=enc["840"]
check("V9 前5min首次遭遇P50>=60s(修正缩放+NavGraph+LOS)", e840["first_p50"]>=60,
      " | ".join(f"{k}版 首遇P10/50/90={v['first_p10']:.0f}/{v['first_p50']:.0f}/{v['first_p90']:.0f}s 再遇间隔P50={v['gap_p50']:.0f}s"
                 for k,v in enc.items()))

# ============ 导出 ============
ENG=dict(
 meta=dict(scale_m_per_px=S, origin_px=[CX,CY], span_m="839x685", safe_circle=TIANJIE,
           coordinate="世界米制, X东Y北, z=地面0"),
 boundary=[[round(x,1),round(y,1)] for x,y in (W(p) for p in BOUNDARY)],
 walls=[dict(cls=wc, height=hz, z0=0,
             blink=("DENY" if wc=="BOUND" else "ALLOW"), fly=("DENY" if wc=="BOUND" else "ALLOW"),
             pts=[[round(a*S- CX*S+0,1) for a in (0,)] and [round((x-CX)*S,1),round((CY-y)*S,1)] for x,y in g.exterior.coords])
        for g,wc,hz in WALLS],
 highlands=[dict(name=h["name"], z=h["z"], overlook_m=h["overlook"],
                 poly=[[round((x-CX)*S,1),round((CY-y)*S,1)] for x,y in h["poly"]],
                 ramps=[[[round((x-CX)*S,1),round((CY-y)*S,1)] for x,y in r] for r in h["ramps"]]) for h in HIGHLANDS],
 nodes={nodes[k]:[round((k[0]-CX)*S,1),round((CY-k[1])*S,1)] for k in nodes},
 edges=[dict(a=a,b=b,cls=cls,width=w,length=round(L,1),
             walk="ALLOW", blink="ALLOW", fly="ALLOW") for a,b,ka,kb,cls,w,L in edges],
 courts={n:dict(center=[round((c['center'][0]-CX)*S,1),round((CY-c['center'][1])*S,1)],
   hex=[[round((x-CX)*S,1),round((CY-y)*S,1)] for x,y in c["hex"]],
   gates=[[round((g[0]-CX)*S,1),round((CY-g[1])*S,1)] for g,att in c["gates"]],
   final_shops=[[round((x-CX)*S,1),round((CY-y)*S,1)] for x,y in c["shops"]],
   revives=[[round((x-CX)*S,1),round((CY-y)*S,1)] for x,y in c["revives"]],
   rocks=[[round((x-CX)*S,1),round((CY-y)*S,1)] for x,y in c["rocks"]]) for n,c in COURTS.items()},
 pigs=[dict(id=f"P{i+1:02d}", pos=[round((p[0]-CX)*S,1),round((CY-p[1])*S,1)]) for i,p in enumerate(PIGS)],
 dragons=[dict(id=f"DK{i+1}", pos=[round((p[0]-CX)*S,1),round((CY-p[1])*S,1)]) for i,p in enumerate(DKS)],
 elites=[dict(id=f"E{i+1}", pos=[round((p[0]-CX)*S,1),round((CY-p[1])*S,1)]) for i,p in enumerate(ELITES)],
 shops_micro=[dict(id=m["id"], macro=m["macro"],
                   pos=[round((m["pos"][0]-CX)*S,1),round((CY-m["pos"][1])*S,1)]) for m in SHOP_MICRO],
 spawn_micro=[dict(id=m["id"], zone=m["zone"], facing_deg=m["facing"],
                   pos=[round((m["pos"][0]-CX)*S,1),round((CY-m["pos"][1])*S,1)]) for m in SPAWN_MICRO],
 rocks=[dict(id=f"H{i+1:02d}", r=2.0, pos=[round((p[0]-CX)*S,1),round((CY-p[1])*S,1)]) for i,p in enumerate(ROCKS)],
 monster_slots=[dict(s, pos=[round((s['pos'][0]-CX)*S,1),round((CY-s['pos'][1])*S,1)],
                     migration=[[round((m[0]-CX)*S,1),round((CY-m[1])*S,1)] for m in s["migration"]]) for s in MON_SLOTS],
 nests=NESTS, nest_links=nest_links,
 chest_pool=[[round((p[0]-CX)*S,1),round((CY-p[1])*S,1)] for p in CHEST_POOL],
 chokes=[[round((p[0]-CX)*S,1),round((CY-p[1])*S,1)] for p in GATES_PX],
)
with open(os.path.join(OUT,"map_engineering_840.json"),"w",encoding="utf-8") as f:
    json.dump(ENG,f,ensure_ascii=False,indent=1)
for fn,rows,hdr in [
  ("map_nodes_840.csv",[[nodes[k],round((k[0]-CX)*S,1),round((CY-k[1])*S,1)] for k in nodes],["id","x_m","y_m"]),
  ("map_edges_840.csv",[[a,b,cls,w,round(L,1)] for a,b,ka,kb,cls,w,L in edges],["a","b","class","width_m","length_m"]),
]:
    with open(os.path.join(OUT,fn),"w",newline="",encoding="utf-8-sig") as f:
        wcs=csv.writer(f); wcs.writerow(hdr); wcs.writerows(rows)

# ============ 渲染 ============
plt.rcParams["font.family"]=["Microsoft YaHei","SimHei"]; plt.rcParams["axes.unicode_minus"]=False
def draw(ax, label=True, layers=("zone","wall","road","court","poi","rock","spawn","shop","gate","high")):
    ax.set_facecolor("#0d1622")
    ax.add_patch(MPoly([W(p) for p in BOUNDARY],closed=True,fc="#1d3040",ec="#7e9cac",lw=2,zorder=1))
    tints={"断金坊":"#29515a","蛛丝峡":"#4b355e","龙脊渊":"#3c5b69","百足城":"#5d4233","烬水市":"#5e3036","迷魂田":"#30566b"}
    if "zone" in layers:
        for zn,poly in ZONES.items():
            ax.add_patch(MPoly([W(p) for p in poly],closed=True,fc=tints[zn],ec="none",alpha=.3,zorder=2))
    if "wall" in layers:
        for g,wc,hz in WALLS:
            col="#5b7181" if wc=="VAULT" else "#8494a4"
            ax.add_patch(MPoly([W(p) for p in g.exterior.coords],closed=True,fc="#141d26",ec=col,
                               lw=1.6 if wc=="BOUND" else 1.0,zorder=4))
    if "high" in layers:
        for h in HIGHLANDS:
            ax.add_patch(MPoly([W(p) for p in h["poly"]],closed=True,fc="#243b33",ec="#7fbf9f",lw=1.4,zorder=4))
    lwm={"MAIN":5,"SIDE":2.6,"RISK":1.3,"COURT":3,"DEN":1.8,"ARENA":2.6,"SHOP":1.8,"SPAWNL":1.2,"SIDEDOOR":1.5,"POCKET":1.2,"RAMP":2.0,"BREACH":1.5}
    cm={"MAIN":"#8aa3b2","SIDE":"#b7cfd8","RISK":"#7798a6","COURT":"#caa27a","DEN":"#c8a25f","ARENA":"#b18ad0",
        "SHOP":"#d9c27a","SPAWNL":"#6f93c9","SIDEDOOR":"#98e0c8","POCKET":"#6faf98","RAMP":"#7fbf9f","BREACH":"#e0a898"}
    stl={"RISK":(0,(3,2)),"SPAWNL":(0,(1,1.5)),"SIDEDOOR":(0,(2,1.4)),"POCKET":(0,(1,1)),"BREACH":(0,(2,1))}
    if "road" in layers:
        for a,b,ka,kb,cls,w,L in edges:
            (x1,y1),(x2,y2)=W(ka),W(kb)
            ax.add_line(Line2D([x1,x2],[y1,y2],lw=lwm[cls],color=cm[cls],linestyle=stl.get(cls,"-"),
                        solid_capstyle="round",zorder=3,alpha=.95))
    if "court" in layers:
        for cname,c in COURTS.items():
            ax.add_patch(MPoly([W(p) for p in c["hex"]],closed=True,fc="#3f1f35",ec="#ff9e75",lw=2.2,zorder=5))
            x,y=W(c["center"]); ax.add_patch(MCirc((x,y),6,fc="#7d2839",ec="#ffbf8b",lw=1.4,zorder=7))
            for s in c["shops"]:
                sx,sy=W(s); ax.add_patch(MRect((sx-3,sy-3),6,6,fc="#31465a",ec="#ffd66e",lw=1,zorder=7))
            for r in c["revives"]:
                rx,ry=W(r); ax.add_patch(MCirc((rx,ry),2,fc="#234b7f",ec="#9ed5ff",lw=.8,zorder=7))
            if label:
                ax.text(x,y-14,cname.split("_")[1],color="#ffcf9e",fontsize=8,ha="center",zorder=9)
    def dots(pts,r,fc,ec,tag,lay):
        if lay not in layers: return
        for i,p in enumerate(pts):
            x,y=W(p); ax.add_patch(MCirc((x,y),r,fc=fc,ec=ec,lw=1.1,zorder=6))
            if label: ax.text(x+r+1,y,f"{tag}{i+1}",color=ec,fontsize=5.5,va="center",zorder=9)
    dots(PIGS,5.5,"#8b6335","#ffd486","P","poi"); dots(DKS,7,"#5b347b","#e4b5ff","DK","poi")
    dots(ELITES,6,"#375a3b","#a9e3a1","E","poi")
    if "spawn" in layers:
        for m in SPAWN_MICRO:
            x,y=W(m["pos"]); ax.add_patch(MCirc((x,y),3,fc="#234b7f",ec="#9ed5ff",lw=1,zorder=6))
    if "shop" in layers:
        for i,p in enumerate(SHOPS):
            x,y=W(p); ax.add_patch(MRect((x-5,y-5),10,10,fc="#31465a",ec="#ffd66e",lw=1.2,zorder=6))
            if label: ax.text(x+7,y,f"S{i+1}",color="#ffd66e",fontsize=5.5,va="center",zorder=9)
    if "rock" in layers:
        for p in ROCKS:
            x,y=W(p); ax.add_patch(MCirc((x,y),3.2,fc="#365e60",ec="#91d4bc",lw=1,zorder=6))
    if "gate" in layers:
        for p in GATES_PX:
            x,y=W(p); ax.add_patch(MRect((x-4,y-4),8,8,fc="#152d3b",ec="#6ed8ef",lw=1.4,zorder=7,angle=45))
    ax.set_aspect("equal"); ax.grid(color="#22303e",lw=.4,zorder=0); ax.tick_params(colors="#5b7181",labelsize=7)

def full_fig(title, fname, layers=None, extra=None):
    fig,ax=plt.subplots(figsize=(16.5,13.2),dpi=145); fig.patch.set_facecolor("#0d1622")
    draw(ax, True, layers or ("zone","wall","road","court","poi","rock","spawn","shop","gate","high"))
    ax.set_xlim(-540,540); ax.set_ylim(-420,420)
    if extra: extra(ax)
    ax.set_title(title,color="#e9edf2",fontsize=13,pad=12)
    fig.savefig(os.path.join(OUT,fname+".png"),bbox_inches="tight",facecolor="#0d1622")
    if "总图" in fname: fig.savefig(os.path.join(OUT,fname+".svg"),bbox_inches="tight",facecolor="#0d1622")
    plt.close(fig)
full_fig("百眼迷城 · 840米灰盒总图 v2（等效跨度840m｜初始安全圆Ø1040m｜三庭Ø≤90m｜墙体差集NavGraph）",
         "百眼迷城_840米灰盒总图_v2")
# 天劫阶段覆盖图
def tj_extra(ax):
    for ph,col in zip(TIANJIE["phases"][:3],("#6ed8ef","#8fd3a0","#e0c46e")):
        ax.add_patch(MCirc((0,0),ph["r"],fill=False,ec=col,lw=2,ls="--",zorder=8))
        ax.text(0,ph["r"]-16,f"r={ph['r']}m@{ph['t0']:.0f}min",color=col,fontsize=8,ha="center",zorder=9)
full_fig("天劫阶段覆盖图（Ø1040→640→360, 之后圈心移向决赛庭）","天劫阶段覆盖图_v2",extra=tj_extra)
for cname,c in COURTS.items():
    def ce(ax,c=c,cname=cname):
        cw=W(c["center"])
        for r,col in ((90,"#e0c46e"),(60,"#ef8f6e")):
            ax.add_patch(MCirc(cw,r,fill=False,ec=col,lw=2,ls="--",zorder=8))
        ax.add_line(Line2D([0,cw[0]],[0,cw[1]],color="#ffb0b0",lw=1.5,ls=":",zorder=8))
        ax.text(cw[0],cw[1]+96,f"决赛庭={cname.split('_')[1]} 圈心轨迹→",color="#ffb0b0",fontsize=9,ha="center",zorder=9)
    full_fig(f"决赛庭圈心图 · {cname.split('_')[1]}（180→90→60→0, 圈心原点→庭心）",f"决赛庭圈心_{cname.split('_')[1]}",extra=ce)
# 分层图
for lay,fname,title in [(("wall","road","gate","high"),"分层_路网墙体","路网+墙体+窄关+高台"),
  (("road","poi"),"分层_资源","肥猪/龙宫/首领"),(("road","shop"),"分层_商店","16商店宏区(微点见JSON)"),
  (("road","spawn"),"分层_出生","15宏区×2微出生位"),(("road","rock"),"分层_伏石","24伏石候选")]:
    full_fig("百眼迷城 分层图 · "+title,fname,layers=("zone",)+lay)
# 三尺寸对照
fig,axes=plt.subplots(1,3,figsize=(22,8),dpi=110); fig.patch.set_facecolor("#0d1622")
for axx,(sc,tag) in zip(axes,[(760/840,"760m版"),(1.0,"840m版(A原型)"),(960/840,"960m版")]):
    draw(axx,False); axx.set_xlim(-540*sc,540*sc); axx.set_ylim(-420*sc,420*sc)
    axx.set_title(tag+f"（等效跨度×{sc:.3f}）",color="#e9edf2",fontsize=11)
fig.savefig(os.path.join(OUT,"百眼迷城_760_840_960对照图_v2.png"),bbox_inches="tight",facecolor="#0d1622")
plt.close(fig)
# 区块放大(P1-5: 视窗内标签)
ZOOMS={"断金坊":(-420,-40,-40,340),"蛛丝峡":(-120,270,80,350),"龙脊渊":(150,470,40,345),
 "百足城":(-420,-70,-240,60),"烬水市":(120,470,-260,60),"迷魂田":(-250,210,-360,-80),
 "万劫三庭":(-120,260,-150,190)}
for zn,(x0,x1,y0,y1) in ZOOMS.items():
    fig,ax=plt.subplots(figsize=(10,8.5),dpi=140); fig.patch.set_facecolor("#0d1622")
    draw(ax,False)
    # 只画视窗内标签
    for i,p in enumerate(PIGS):
        x,y=W(p)
        if x0<x<x1 and y0<y<y1: ax.text(x+6,y,f"P{i+1}",color="#ffd486",fontsize=8,va="center",zorder=9)
    for i,p in enumerate(DKS):
        x,y=W(p)
        if x0<x<x1 and y0<y<y1: ax.text(x+8,y,f"DK{i+1}",color="#e4b5ff",fontsize=8,va="center",zorder=9)
    for i,p in enumerate(SHOPS):
        x,y=W(p)
        if x0<x<x1 and y0<y<y1: ax.text(x+7,y,f"S{i+1}",color="#ffd66e",fontsize=8,va="center",zorder=9)
    for cname,c in COURTS.items():
        x,y=W(c["center"])
        if x0<x<x1 and y0<y<y1: ax.text(x,y-14,cname.split("_")[1],color="#ffcf9e",fontsize=10,ha="center",zorder=9)
    ax.set_xlim(x0,x1); ax.set_ylim(y0,y1)
    ax.set_title(f"百眼迷城 区块放大 v2 · {zn}（米）",color="#e9edf2",fontsize=12,pad=10)
    fig.savefig(os.path.join(OUT,f"区块放大_{zn}_v2.png"),bbox_inches="tight",facecolor="#0d1622")
    plt.close(fig)

with open(os.path.join(OUT,"map_validation_report_v2.txt"),"w",encoding="utf-8-sig") as f:
    f.write("\n".join(rep))
print("\n".join(rep))
print("OUTPUT ->", OUT)
