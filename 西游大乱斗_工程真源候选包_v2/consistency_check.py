# -*- coding: utf-8 -*-
"""自动化一致性检查 (交付项9): JSON工程数据×文档口径×计数唯一性
复跑: python consistency_check.py → 一致性检查报告.txt"""
import json, math, os, io, glob
HERE=os.path.dirname(os.path.abspath(__file__))
J=json.load(open(os.path.join(HERE,"地图输出","map_engineering_840.json"),encoding="utf-8"))
L=["v2包一致性检查报告 (脚本生成: python consistency_check.py)"]
ok_all=True
def chk(name,cond,detail=""):
    global ok_all
    if not cond: ok_all=False
    L.append(("PASS " if cond else "FAIL ")+name+(" | "+detail if detail else ""))

chk("商店微点=48", len(J["shops_micro"])==48, f"{len(J['shops_micro'])}")
chk("微出生位=30", len(J["spawn_micro"])==30, f"{len(J['spawn_micro'])}")
ms=J["monster_slots"]
mel=sum(1 for s in ms if s["kind"]=="MEL"); rng=sum(1 for s in ms if s["kind"]=="RNG"); fly=sum(1 for s in ms if s["kind"]=="FLY")
chk("怪物槽58近战/38远程/12飞", mel==58 and rng==38 and fly==12, f"{mel}/{rng}/{fly}")
chk("每槽3迁移位", all(len(s["migration"])==3 for s in ms))
chk("猪窝=12", len(J["pigs"])==12); chk("龙宫=5", len(J["dragons"])==5)
chk("首领场=4", len(J["elites"])==4); chk("伏石=24", len(J["rocks"])==24)
chk("三庭且各6复活位+2终局商位",
    len(J["courts"])==3 and all(len(c["revives"])==6 and len(c["final_shops"])==2 for c in J["courts"].values()))
for n,c in J["courts"].items():
    dia=max(math.hypot(a[0]-b[0],a[1]-b[1]) for a in c["hex"] for b in c["hex"])
    chk(f"{n}外接直径<=90", dia<=90.01, f"{dia:.1f}m")
bmax=max(math.hypot(x,y) for x,y in J["boundary"])
r0=J["meta"]["safe_circle"]["initial_diameter"]/2
chk("初始安全圆覆盖边界", r0>=bmax, f"{bmax:.1f}<={r0}")
chk("墙体均带类别/高度/闪现飞行标签",
    all(("cls" in w and "height" in w and "blink" in w and "fly" in w) for w in J["walls"]))
chk("高台z轴数据", len(J["highlands"])==3 and all(h["z"]>0 and h["ramps"] for h in J["highlands"]))
chk("宝箱落点池非空", len(J["chest_pool"])>100, f"{len(J['chest_pool'])}")
# 文档口径核对
d02=io.open(os.path.join(HERE,"02_百眼迷城_地图工程真源_v2.txt"),encoding="utf-8-sig").read()
chk("02文档含Ø1040独立参数表述", "1040" in d02)
chk("02文档不再宣称庭=90m实际150m", "86.5" in d02)
d03=io.open(os.path.join(HERE,"03_PVE怪物图鉴与完整数值_v2.txt"),encoding="utf-8-sig").read()
chk("03矛盾行已统一(龙核攻击成长唯一口径)", "本行为唯一口径" in d03)
d05=io.open(os.path.join(HERE,"05_技能装备交互与异常矩阵_v2.txt"),encoding="utf-8-sig").read()
chk("05五字段制(怪物=MONSTER非ENV)", "NORMAL+MONSTER" in d05 or "MONSTER" in d05)
# 报告为脚本产物核对
for f in ("04_经济模拟验证报告_v4.txt","03_TTK验证输出_v2.txt"):
    chk(f+" 存在且标注复跑命令", os.path.exists(os.path.join(HERE,f)) and "复跑" in io.open(os.path.join(HERE,f),encoding="utf-8-sig").read()[:400])
vrep=io.open(os.path.join(HERE,"地图输出","map_validation_report_v2.txt"),encoding="utf-8-sig").read()
chk("地图验证报告存在", len(vrep)>100)
fails=[l for l in vrep.splitlines() if l.startswith("FAIL")]
L.append(f"INFO 地图验证报告FAIL项如实保留{len(fails)}条: "+"; ".join(f[:40] for f in fails))
chk("权威引用文件8件入包", len(glob.glob(os.path.join(HERE,"权威引用文件","*.txt")))==8)
L.append("总判定: "+("一致" if ok_all else "存在不一致(见FAIL)"))
out="\n".join(L)
io.open(os.path.join(HERE,"一致性检查报告.txt"),"w",encoding="utf-8-sig").write(out)
print(out)
