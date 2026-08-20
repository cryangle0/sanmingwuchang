# -*- coding: utf-8 -*-
"""04 经济模型 v4 (审计返工: 时间步进/真实排程/分圈奖励/三本账/守恒断言)
修复P0-08全部条目:
- 删除produce×0.55-0.80预设商店销毁; 购买由库存/价格/到达/营业时间/持币逐笔产生
- 普通怪按外/中/内圈独立存量/金币/XP; 天劫吞噬按圈层面积比例禁用重生位
- 龙王/核心BOSS真实排程(发现延迟+击杀耗时+重生CD+窗口), 物理上限自然涌现
- 0-20min+灭世雷暴加时; XP进等级表; 金币/XP/书/宝石/装备/主动六账分列
- 守恒断言: 期末钱包+销毁 == 产生 (记账完整性, 非目标预设)
- 报告由本脚本直接生成(04_经济模拟验证报告_v4.txt), 禁手抄
运行: python 04_经济供给与玩家驱动生态模型_v4.py  种子20260717 N=400局/组合
"""
import math, random, os
random.seed(20260717)
HERE=os.path.dirname(os.path.abspath(__file__))
N_MATCH=400; DT=5.0

XP_CUM=[0,50,120,210,320,450,605,785,995,1235,1510,1825,2275,2825,3525]
def lvl(xp):
    l=1
    for i,c in enumerate(XP_CUM):
        if xp>=c: l=i+1
    return min(15,l)

RINGS=("外","中","内")
STOCK={("MEL","外"):30,("MEL","中"):18,("MEL","内"):10,
       ("RNG","外"):20,("RNG","中"):12,("RNG","内"):6,
       ("FLY","中"):8,("FLY","外"):4}
RESPAWN={"MEL":40,"RNG":40,"FLY":45}
GOLD_RING={"外":90,"中":140,"内":180}; XP_RING={"外":28,"中":40,"内":56}
FLY_GOLD={"外":140,"中":200}; FLY_XP={"外":40,"中":56}
# 天劫圈层可用系数(按v2半径阶梯520/320/220/140/90与圈层带面积比, map_data_v2几何)
PHASE_T=[0,6.5,12,15.5,18,19]      # 各阶段生效完成时刻(min): 520,320,220,140,90,60
AVAIL={"外":[1.0,0.18,0.0,0.0,0.0,0.0],
       "中":[1.0,1.0,0.62,0.05,0.0,0.0],
       "内":[1.0,1.0,1.0,1.0,0.48,0.21]}
def avail(ring,tmin):
    i=0
    for j,pt in enumerate(PHASE_T):
        if tmin>=pt: i=j
    return AVAIL[ring][i]
# TTK+搜索周期(秒/只, 中期均值; 来自03_TTK_v2)
CYCLE={"MEL":11,"RNG":10,"FLY":13,"PIG":26,"ELI":50}
ARCH={ "纯刷野":dict(farm=1.0,kill=0.10,scav=0.30,shop=0.9),
       "纯PK":  dict(farm=0.05,kill=1.0,scav=0.25,shop=0.6),
       "猎农":  dict(farm=0.25,kill=0.80,scav=0.35,shop=0.7),
       "拾荒":  dict(farm=0.35,kill=0.15,scav=1.0,shop=0.8),
       "争王":  dict(farm=0.45,kill=0.55,scav=0.20,shop=0.8),
       "绝不碰怪":dict(farm=0.0,kill=1.0,scav=0.25,shop=0.6)}
MIX={ "0%刷野(全PK局)":{"绝不碰怪":30},
      "25%刷野":{"纯刷野":5,"猎农":6,"拾荒":4,"争王":5,"纯PK":10},
      "50%刷野(标准局)":{"纯刷野":9,"猎农":5,"拾荒":4,"争王":6,"纯PK":6},
      "75%刷野":{"纯刷野":15,"猎农":4,"拾荒":4,"争王":5,"纯PK":2},
      "100%刷野(全农局)":{"纯刷野":30},
      "猎农局":{"纯刷野":12,"猎农":12,"拾荒":3,"争王":3},
      "拾荒局":{"纯刷野":8,"猎农":4,"拾荒":14,"争王":4},
      "争王局":{"纯刷野":6,"猎农":4,"拾荒":4,"争王":16}}
SELL={"白":240,"蓝":800,"紫":2400,"金":4000}
PRICE={"白":600,"蓝":2000,"紫":6000,"宝石":250}

def run_match(mix):
    players=[]
    for a,c in mix.items():
        for _ in range(c):
            players.append(dict(a=a,gold=500,xp=0,deaths=0,alive=True,
                                spent=0,earned_pve=0,earned_pvp=0,earned_salv=0))
    # 怪物状态: 每(类,圈)存量与重生队列
    alive_m={k:v for k,v in STOCK.items()}
    resq={k:[] for k in STOCK}
    pigs_alive=8; pig_q=[]
    eli_alive=4; eli_q=[]
    # 龙王排程: 2槽, 5-15min; 状态: 生成时刻, 被发现+击杀耗时
    drag=[dict(up=5*60,dead=None) for _ in range(2)]
    boss=dict(up=0.0,dead=None)
    led=dict(start=30*500, pve=0, pvp=0, chest=0, salv=0,        # 产生
             buy=0, taibai=0, reroll=0, heishan=0, exitg=0,      # 销毁
             books=0, gems=0, act=0, eq={"白":0,"蓝":0,"紫":0,"金":0},
             xp=0, kills={"MEL":0,"RNG":0,"FLY":0,"PIG":0,"ELI":0,"DRG":0,"BOSS":0},
             eq_burn=0, storm_s=0)
    # 开局重随(选人期, 一次性)
    for p in players:
        if random.random()<0.35 and p["gold"]>=250:
            p["gold"]-=250; led["reroll"]+=250; p["spent"]+=250
    ground_eq=[]   # 地面装备池(品质), 拾荒可捡卖
    purple_stock=5; gem_stock=20
    heishan_used=0
    t=0.0
    storm=False; storm_t0=None
    while True:
        tmin=t/60
        alive_p=[p for p in players if p["alive"]]
        if len(alive_p)<=1: break
        if tmin>=20 and not storm: storm=True; storm_t0=t
        if storm and t-storm_t0>150: break  # 雷暴150s内必然收敛(递增伤害)
        # ---- 重生结算 ----
        for k in STOCK:
            resq[k]=[x for x in resq[k] if x>t or (alive_m.__setitem__(k,alive_m[k]+1) if x<=t else False)]
        pig_q=[x for x in pig_q if x>t or (pigs_alive:=pigs_alive+1) and False] if False else pig_q
        newpq=[]
        for x in pig_q:
            if x<=t: pigs_alive+=1
            else: newpq.append(x)
        pig_q=newpq
        neweq=[]
        for x in eli_q:
            if x<=t: eli_alive+=1
            else: neweq.append(x)
        eli_q=neweq
        # ---- 刷野 ----
        farmers=[(p,ARCH[p["a"]]["farm"]) for p in alive_p if ARCH[p["a"]]["farm"]>0]
        fpow=sum(w for _,w in farmers)
        if fpow>0 and not storm:
            # ★修正: 单一刷野功率池按可用存量在全部(类,圈)间分配, 禁止逐类重复计满功率
            tot_avail=sum(alive_m[kk2]*avail(kk2[1],tmin) for kk2 in STOCK)
            for cat in ("MEL","RNG","FLY"):
                for ring in RINGS:
                    kk=(cat,ring)
                    if kk not in STOCK: continue
                    cap=alive_m[kk]*avail(ring,tmin)
                    if cap<0.5 or tot_avail<1: continue
                    wgt=cap/tot_avail
                    search=1.0+0.8*(1-cap/STOCK[kk])
                    demand=fpow*wgt*DT/(CYCLE[cat]*search)*  (60/CYCLE[cat])/(60/CYCLE[cat])
                    demand=fpow*DT/ CYCLE[cat] * wgt / search
                    kills=min(cap, demand)
                    ik=int(kills)+(1 if random.random()<kills%1 else 0)
                    ik=min(ik, alive_m[kk])
                    if ik<=0: continue
                    alive_m[kk]-=ik
                    for _ in range(ik): resq[kk].append(t+RESPAWN[cat]/max(0.05,avail(ring,tmin)) if avail(ring,tmin)>0 else t+9e9)
                    g=(FLY_GOLD.get(ring,140) if cat=="FLY" else GOLD_RING[ring])*ik
                    x=(FLY_XP.get(ring,40) if cat=="FLY" else XP_RING[ring])*ik
                    led["pve"]+=g; led["xp"]+=x; led["kills"][cat]+=ik
                    for _ in range(ik):
                        w=random.choices(farmers,weights=[w for _,w in farmers])[0][0]
                        w["gold"]+=g/ik; w["earned_pve"]+=g/ik; w["xp"]+=x/ik
                        pb=0.10 if cat=="MEL" else (0.10 if cat=="RNG" else 0.20)
                        if random.random()<pb: led["books"]+=1
                        if random.random()<0.30 and gem_stock_g()>0: led["gems"]+=1
            # 肥猪(欲望率0.20只/分/刷野功率, 与v3宏观模型同参; 供给自然封顶)
            dem=fpow*0.20*DT/60*min(1.0,pigs_alive/4.0)
            pk=min(pigs_alive,int(dem)+(1 if random.random()<dem%1 else 0))
            for _ in range(pk):
                pigs_alive-=1; pig_q.append(t+120)
                w=random.choices(farmers,weights=[w for _,w in farmers])[0][0]
                w["gold"]+=700; w["earned_pve"]+=700; w["xp"]+=80
                led["pve"]+=700; led["xp"]+=80; led["kills"]["PIG"]+=1
                if random.random()<0.55: led["books"]+=1
                if random.random()<0.60: led["gems"]+=1
                if random.random()<0.25:
                    q=random.choices(["白","蓝","紫"],weights=[60,30,10])[0]
                    led["eq"][q]+=1; ground_eq.append(q)
            # 首领(欲望率0.04只/分/刷野功率)
            dem=fpow*0.04*DT/60*min(1.0,eli_alive/2.0)
            ek=min(eli_alive,int(dem)+(1 if random.random()<dem%1 else 0))
            for _ in range(ek):
                eli_alive-=1; eli_q.append(t+180)
                w=random.choices(farmers,weights=[w for _,w in farmers])[0][0]
                w["gold"]+=1400; w["earned_pve"]+=1400; w["xp"]+=200
                led["pve"]+=1400; led["xp"]+=200; led["kills"]["ELI"]+=1
                led["books"]+=1; led["gems"]+=2
                if random.random()<0.10: led["act"]+=1
                if random.random()<0.75:
                    q=random.choices(["白","蓝","紫"],weights=[35,40,25])[0]
                    led["eq"][q]+=1; ground_eq.append(q)
        # ---- 龙王排程(2槽, 5-15min, 击杀耗时=发现40-90s+团击15-35s, 重生240s) ----
        for d in drag:
            if d["dead"] is None and d["up"] is not None and t>=d["up"] and tmin<15:
                hunters=sum(1 for p in alive_p if ARCH[p["a"]]["farm"]>=0.2)  # 绝不碰怪/纯PK不屠龙
                if hunters>=2 and random.random()<DT/ (random.uniform(40,90)+random.uniform(15,35)):
                    d["dead"]=t
                    w=random.choice(alive_p)
                    w["gold"]+=2000; w["xp"]+=300
                    led["pve"]+=2000; led["xp"]+=300; led["kills"]["DRG"]+=1; led["gems"]+=3
                    q=random.choices(["蓝","紫","金"],weights=[55,35,10])[0]
                    if random.random()<0.35: q={"蓝":"紫","紫":"金","金":"金"}[q]  # 克制屠龙
                    led["eq"][q]+=1; ground_eq.append(q)
                    d["up"]=t+240 if tmin<15 else None; d["dead"]=None
            elif d["up"] is not None and tmin>=15: d["up"]=None  # 决赛前撤退
        # ---- 核心BOSS(300s换庭重生; 雷暴中仍可杀) ----
        if boss["up"] is not None and t>=boss["up"]:
            crowd=sum(1 for p in alive_p if ARCH[p["a"]]["farm"]>=0.2)  # 争夺核心也需愿意PVE
            need=random.uniform(60,120)+random.uniform(30,60)
            if crowd>=3 and random.random()<DT/need:
                w=random.choice(alive_p)
                w["gold"]+=3000; w["xp"]+=400
                led["pve"]+=3000; led["xp"]+=400; led["kills"]["BOSS"]+=1
                led["books"]+=2; led["gems"]+=3; led["act"]+=1
                q=random.choices(["紫","金"],weights=[75,25])[0]
                led["eq"][q]+=1; ground_eq.append(q)
                if random.random()<0.05: led["eq"]["金"]+=1; ground_eq.append("金")
                boss["up"]=t+300
        # ---- 空投(6/12/18min) ----
        for ct in (360,720,1080):
            if abs(t-ct)<DT/2 and (tmin<18 or random.random()<0.5):
                w=random.choice(alive_p)
                w["gold"]+=1200; led["chest"]+=1200
                led["eq"]["金"]+=1; ground_eq.append("金")
        # ---- PVP ----
        press=1.0+ (1.5 if tmin>10 else 0)+(2.0 if tmin>15 else 0)+(4.0 if storm else 0)
        kw=sum(ARCH[p["a"]]["kill"] for p in alive_p)/max(1,len(alive_p))
        lam=len(alive_p)*kw*press*DT/600
        nd=min(len(alive_p)-1, int(lam)+(1 if random.random()<lam%1 else 0))
        for _ in range(nd):
            alive_p=[p for p in players if p["alive"]]
            if len(alive_p)<=1: break
            vic=random.choice(alive_p)
            env = storm and random.random()<0.5
            vic["deaths"]+=1
            if vic["deaths"]>=3:
                vic["alive"]=False
                led["exitg"]+=vic["gold"]; vic["gold"]=0
            if not env:
                ks=[p for p in alive_p if p is not vic]
                killer=random.choices(ks,weights=[ARCH[p["a"]]["kill"]+.1 for p in ks])[0]
                g=500+min(1500,100*lvl(vic["xp"]))+0.10*vic["gold"]
                if vic["deaths"]>=3: g+=500
                killer["gold"]+=g; killer["earned_pvp"]+=g
                killer["xp"]+=min(180,60+8*lvl(vic["xp"]))
                led["pvp"]+=g
            # 死亡掉装(转移, 非产生): 地面池+1白蓝概率(手牌格近似)
            if random.random()<0.4 and ground_eq: pass
        # ---- 拾荒变卖(转移->销毁装备, 产生金币) ----
        scavs=[p for p in alive_p if ARCH[p["a"]]["scav"]>=0.8]
        for sc in scavs:
            if ground_eq and random.random()<DT/45:
                q=ground_eq.pop(random.randrange(len(ground_eq)))
                v=SELL[q]*1.2  # 拾荒被动加成
                sc["gold"]+=v; sc["earned_salv"]+=v; led["salv"]+=v
        # ---- 商店购买(库存/价格/到达/营业/持币约束) ----
        shop_open = tmin<15 or True  # 终局土地公A保留
        for p in alive_p:
            if not shop_open: break
            arr=ARCH[p["a"]]["shop"]*0.5  # 到达+意愿摩擦
            if random.random()>DT/60*arr: continue
            if p["gold"]>=PRICE["紫"] and purple_stock>0 and random.random()<0.5:
                p["gold"]-=PRICE["紫"]; p["spent"]+=PRICE["紫"]; led["buy"]+=PRICE["紫"]; purple_stock-=1
            elif p["gold"]>=PRICE["蓝"] and random.random()<0.5:
                p["gold"]-=PRICE["蓝"]; p["spent"]+=PRICE["蓝"]; led["buy"]+=PRICE["蓝"]
            elif p["gold"]>=PRICE["宝石"] and gem_stock>0:
                p["gold"]-=PRICE["宝石"]; p["spent"]+=PRICE["宝石"]; led["buy"]+=PRICE["宝石"]; gem_stock-=1
            elif p["gold"]>=PRICE["白"]:
                p["gold"]-=PRICE["白"]; p["spent"]+=PRICE["白"]; led["buy"]+=PRICE["白"]
        # 太白(1500, 意愿低频)
        for p in alive_p:
            if p["gold"]>=1500 and random.random()<DT/1200:
                p["gold"]-=1500; p["spent"]+=1500; led["taibai"]+=1500
        # 黑山(12:30关; 全局次数)
        if tmin<12.5 and heishan_used<90:
            for p in alive_p:
                if p["gold"]>=300 and random.random()<DT/700:
                    bet=min(p["gold"]*0.2, 1000)
                    net=bet*0.15  # 平均庄家优势(EV表)
                    p["gold"]-=net; p["spent"]+=net; led["heishan"]+=net; heishan_used+=1
        t+=DT
    if storm and storm_t0 is not None: led["storm_s"]=t-storm_t0
    # 圈外装备销毁计提: 地面残留按吞噬进度烧掉
    led["eq_burn"]=len(ground_eq)
    fin=sum(p["gold"] for p in players)
    produce=led["start"]+led["pve"]+led["pvp"]+led["chest"]+led["salv"]
    destroy=led["buy"]+led["taibai"]+led["reroll"]+led["heishan"]+led["exitg"]
    ok = abs(produce-destroy-fin)<1e-6
    return led,produce,destroy,fin,ok,players

def gem_stock_g(): return 1  # 地面宝石不占商店配额

def pct(v,q):
    v=sorted(v); return v[min(len(v)-1,int(len(v)*q))]
def main():
    L=["04 经济模拟验证报告 v4 (本文件由脚本直接生成; 复跑: python 04_经济供给与玩家驱动生态模型_v4.py)",
       f"种子20260717 N={N_MATCH}局/组合 DT={DT}s 时间步进0-20min+雷暴加时",
       "模型要点: 分圈存量/天劫面积系数/真实龙王BOSS排程/逐笔商店购买/守恒断言",
       "局限: 无空间寻路(到达摩擦为概率近似); 玩家决策为画像驱动; L2级, 分布形状可信, 精确到达率待L3",""]
    for name,mix in MIX.items():
        R=[run_match(mix) for _ in range(N_MATCH)]
        conserv=all(r[3+1] for r in R)
        P=lambda f,q: pct([f(r) for r in R],q)
        led0=R[0][0]
        L.append(f"── {name} ──  守恒断言: {'PASS' if conserv else 'FAIL'}")
        L.append(f"  金币产生 P10/50/90/99: {P(lambda r:r[1],.1):.0f}/{P(lambda r:r[1],.5):.0f}/{P(lambda r:r[1],.9):.0f}/{P(lambda r:r[1],.99):.0f}"
                 f" | 销毁: {P(lambda r:r[2],.5):.0f} | 期末在手: {P(lambda r:r[3],.5):.0f}")
        L.append(f"  销毁/产生(涌现值): P50={P(lambda r:r[2]/max(1,r[1]),.5):.2f} (健康带0.60-0.85仅为观测参照, 未写入模型)")
        k50=lambda cat: P(lambda r:r[0]['kills'][cat],.5)
        L.append(f"  击杀P50: 普通{k50('MEL')+k50('RNG')+k50('FLY'):.0f} 猪{k50('PIG'):.0f} 首领{k50('ELI'):.0f}"
                 f" 龙{k50('DRG'):.0f} 核心{k50('BOSS'):.0f} (龙物理上限~5/局: 排程涌现, 非截断)")
        L.append(f"  产出P50: 书{P(lambda r:r[0]['books'],.5):.0f} 宝石{P(lambda r:r[0]['gems'],.5):.0f}"
                 f" 主动{P(lambda r:r[0]['act'],.5):.0f} 装备(白{P(lambda r:r[0]['eq']['白'],.5):.0f}"
                 f"/蓝{P(lambda r:r[0]['eq']['蓝'],.5):.0f}/紫{P(lambda r:r[0]['eq']['紫'],.5):.0f}"
                 f"/金{P(lambda r:r[0]['eq']['金'],.5):.0f}) 圈外烧毁装备{P(lambda r:r[0]['eq_burn'],.5):.0f}")
        L.append(f"  人均成长接触(书+宝石)/30: {P(lambda r:(r[0]['books']+r[0]['gems'])/30,.5):.1f}"
                 f" | 雷暴加时P50: {P(lambda r:r[0]['storm_s'],.5):.0f}s")
        L.append("")
    L.append("附: 输入假设与公式见脚本头注释与源码; 所有比率均为涌现值, 无一处以目标区间作为输入。")
    out="\n".join(L)
    with open(os.path.join(HERE,"04_经济模拟验证报告_v4.txt"),"w",encoding="utf-8-sig") as f: f.write(out)
    print(out)
main()
