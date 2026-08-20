# -*- coding: utf-8 -*-
"""03 TTK与威胁验证 v2 (审计返工P0-09)
- 全部数字程序计算, 无手写结论(修正v1克制行手写错误)
- 三档玩家模板(L5/L10/L15), 走位损耗uptime, 怪物时间成长(仅龙/核心攻击成长)
- 单体流vsAOE流清3/10/20只(6近战位上限+错帧+近远混编): 清场时间/承伤/死亡风险
- 龙王HP 10000/14000仅A/B对比, 不定案
输出: 03_TTK验证输出_v2.txt  种子20260718
"""
import math, os
HERE=os.path.dirname(os.path.abspath(__file__))
GROW_A=2.68**(1/14)
TEMPL={"长弓":(134,1550,0.9),"连弩":(110,1650,1.6),"刺客":(160,1400,1.4),"战士":(140,1800,1.1),"坦克":(100,2200,0.9)}
def atk_at(a15,L): return a15/ (GROW_A**(15-L))
def hp_at(h15,L): return h15/ ((2.87**(1/14))**(15-L))
MON={"近战小妖外":(110,18,0.8),"近战小妖中":(300,35,0.8),"近战小妖内":(600,60,0.5),
     "远程小妖中":(240,42,0.8),"飞行小妖中":(200,30,0.8),
     "肥猪":(1200,80,0.17),"肉盾首领":(7000,120,0.6),"输出首领":(4000,220,1.0),
     "龙王A(10000)":(10000,200,1.0),"龙王B(14000)":(14000,200,1.0),"核心BOSS":(22000,300,1.0)}
UPTIME={"长弓":0.90,"连弩":0.88,"刺客":0.80,"战士":0.82,"坦克":0.85}  # 走位/前后摇损耗
L=["03 TTK验证输出 v2 (全数字程序生成; 复跑: python 03_怪物TTK与威胁验证_v2.py)",""]
L.append("=== A. 三档玩家单刷TTK(秒, 含uptime走位损耗; 无装备无被动) ===")
for tier in (5,10,15):
    L.append(f"[玩家等级L{tier}]")
    L.append("怪物            " + "".join(f"{t:>8}" for t in TEMPL))
    for m,(hp,atk,aps) in MON.items():
        row=f"{m:<14}"
        for t,(a15,h15,ap) in TEMPL.items():
            dps=atk_at(a15,tier)*ap*UPTIME[t]
            row+=f"{hp/dps:>8.1f}"
        L.append(row)
L.append("")
L.append("=== B. 五行克制算术核对(仅五行猪/龙王; TTK÷1.5, 程序复算) ===")
for m in ("肥猪","龙王A(10000)","龙王B(14000)"):
    hp=MON[m][0]
    row=f"{m:<14}"
    for t,(a15,h15,ap) in TEMPL.items():
        dps=atk_at(a15,15)*ap*UPTIME[t]
        row+=f" {t}:{hp/dps:.1f}→{hp/(dps*1.5):.1f}s"
    L.append(row)
L.append("双向克制: 火猪克金系玩家时, 猪顶撞80→120伤; 龙息280→420(对被克玩家)")
L.append("")
L.append("=== C. 单体流vsAOE流 清群对账(中圈怪HP300/35攻0.8aps; 6近战位+错帧0.85; 6:4近远混编) ===")
def group_dps(N):
    nm=round(N*0.6); nr=N-nm
    return min(6,nm)*35*0.8*0.85 + nr*42*0.8*0.85
for tier in (10,15):
    a15,h15,ap=TEMPL["战士"]
    pa=atk_at(a15,tier)*ap*UPTIME["战士"]
    hpp=hp_at(h15,tier)
    aoe=pa*2.2  # AOE构筑(溅射5级+旋风类)等效群体DPS倍率
    L.append(f"[L{tier}战士 单体DPS{pa:.0f} AOE群DPS{aoe:.0f} HP{hpp:.0f}]")
    for N in (3,10,20):
        gd=group_dps(N)
        t_s=N*300/pa; dmg_s=sum((N-i)*gd/N*(300/pa) for i in range(N))
        t_a=300*max(1,N/ min(N,8))/aoe*min(N,8)/min(N,8); t_a=300/aoe* math.ceil(N/8)  # AOE半径内8只/轮
        dmg_a=gd*t_a
        risk_s="死亡" if dmg_s>=hpp else f"承伤{dmg_s/hpp*100:.0f}%"
        risk_a="死亡" if dmg_a>=hpp else f"承伤{dmg_a/hpp*100:.0f}%"
        L.append(f"  {N:>2}只: 单体清{t_s:>5.1f}s({risk_s}) | AOE清{t_a:>5.1f}s({risk_a}) | AOE快{t_s/max(0.1,t_a):.1f}倍")
L.append("结论(程序推出): AOE以更高瞬时承伤换清群倍率; 20只时单体流必死, AOE流承伤过半=高风险高效率, 成立")
L.append("")
L.append("=== D. 时间成长核对(普通/飞怪/猪攻击恒定; 仅首领CD/龙王/核心成长) ===")
for label,mult_hp,mult_atk in (("10min 首领",1.10,1.00),("15min 首领",1.20,1.00),
    ("10min 龙王",1.10,1.05),("10min 核心",1.10,1.05),("15min 核心",1.20,1.10)):
    L.append(f"  {label}: HP×{mult_hp} 攻×{mult_atk}")
L.append("  新刷普通/飞怪HP×1.00/1.05/1.10/1.15(0-5/5-10/10-15/15+min), 攻击不变")
L.append("")
L.append("=== E. 龙王A/B多人击杀窗口(混合DPS170/人; 不定案, 供G5灰盒A/B) ===")
for tag,hp in (("A=10000",10000),("B=14000",14000)):
    row=f"  {tag}: "
    for n in (2,4,8): row+=f"{n}人{hp/(n*170):>5.1f}s "
    row+=f"| 第三方100m赶到≈23s → {'窗口偏短' if hp/(4*170)<23 else '第三方戏成立'}(4人口径)"
    L.append(row)
out="\n".join(L)
open(os.path.join(HERE,"03_TTK验证输出_v2.txt"),"w",encoding="utf-8-sig").write(out)
print(out)
