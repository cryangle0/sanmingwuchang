# fanavatar.org 域名与新加坡服务器配置说明

> 文档生成时间：2026-08-06 (Asia/Shanghai / CST)  
> 文档路径：  
> - 本机：`E:\angsa\angsa_data\Games\JourneyWestGreatBrawl\服务器\fanavatar.org-setup.md`  
> - 服务器：`/fanavatar.org-setup.md`

---

## 1. 摘要

已将域名 **fanavatar.org** 解析到阿里云新加坡 ECS（公网 IP **47.84.61.45**），并启用 **Let's Encrypt HTTPS**。

| 项目 | 值 |
|------|-----|
| 域名 | `fanavatar.org` |
| 注册商 | Spaceship |
| DNS 托管 | Cloudflare（账号 `Stoneworkerstock@gmail.com`） |
| 目标服务器 | 阿里云 ECS 新加坡 `ap-southeast-1` / `ap-southeast-1b` |
| 公网 IP | `47.84.61.45` |
| 解析状态 | 已生效（`@` 与 `www` 均指向该 IP） |
| HTTPS | Let's Encrypt，已启用；HTTP 301 跳转 HTTPS |
| 站点 | https://fanavatar.org/ / https://www.fanavatar.org/ |

---

## 2. 服务器连接方式

### 2.1 连接信息

| 项目 | 值 |
|------|-----|
| 公网 IP | `47.84.61.45` |
| 也可使用域名 | `fanavatar.org`（已解析到上述 IP） |
| SSH 端口 | `22` |
| 用户名 | `root` |
| 推荐登录方式 | SSH 公钥免密（已配置） |
| 本机私钥 | `C:\Users\xinzh\.ssh\id_ed25519` |
| 本机公钥 | `C:\Users\xinzh\.ssh\id_ed25519.pub` |
| 公钥注释 | `angsa2025success@protonmail.com` |
| 服务器授权文件 | `/root/.ssh/authorized_keys` |
| 初始 root 密码 | `Aaa123456!`（开通时提供；建议尽快修改，优先用密钥登录） |

### 2.2 推荐：密钥免密登录

本机 Windows OpenSSH 示例：

```bash
ssh -i C:\Users\xinzh\.ssh\id_ed25519 root@47.84.61.45
```

域名登录（解析正常时）：

```bash
ssh -i C:\Users\xinzh\.ssh\id_ed25519 root@fanavatar.org
```

可选：写入本机 `C:\Users\xinzh\.ssh\config`：

```sshconfig
Host fanavatar
    HostName 47.84.61.45
    User root
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
```

之后可直接：

```bash
ssh fanavatar
```

### 2.3 密码登录（备用）

```bash
ssh root@47.84.61.45
# 密码：Aaa123456!
```

说明：

- 2026-08-06 已将本机 `id_ed25519` 公钥写入服务器 `authorized_keys`，密钥登录已验证可用。
- `authorized_keys` 中另有一条阿里云控制台相关的 `ssh-rsa` 公钥（注释类似 `skp-t4nbmhpp743f70hlm65l`）。
- 建议确认密钥稳定后修改 root 密码，并可考虑关闭密码登录（`PasswordAuthentication no`）。

### 2.4 常用运维命令

```bash
# 看服务与端口
ss -lntup
systemctl status nginx
systemctl status ssh

# 看证书与续期
certbot certificates
systemctl list-timers certbot.timer
certbot renew --dry-run

# 看站点与日志
ls -la /var/www/fanavatar.org/
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

---

## 3. 服务器基本情况

### 3.1 云实例

| 项目 | 值 |
|------|-----|
| 云厂商 | 阿里云 Alibaba Cloud |
| 地域 | `ap-southeast-1`（新加坡） |
| 可用区 | `ap-southeast-1b` |
| 实例 ID | `i-t4n8d1ikyz785yqbzk2u` |
| 主机名 | `iZt4n8d1ikyz785yqbzk2uZ` |
| 公网 IP / EIP | `47.84.61.45` |
| 内网 IP | `172.30.33.212/20`（eth0） |
| 虚拟化 | KVM |
| 系统时区 | `Asia/Shanghai`（CST, +0800）；NTP 已同步 |

### 3.2 操作系统与硬件

| 项目 | 值 |
|------|-----|
| 操作系统 | Ubuntu 22.04.5 LTS (Jammy) |
| 内核 | Linux 5.15.0-186-generic x86_64 |
| CPU | 2 vCPU，Intel Xeon Platinum（1 核 × 2 线程） |
| 内存 | 总计约 1.6 GiB；可用约 1.1 GiB（记录时） |
| Swap | 4.0 GiB（`/swapfile`，记录时未使用） |
| 系统盘 | `/dev/vda3` ext4，约 40G，已用约 6.8G（19%），可用约 31G |
| EFI 分区 | `/dev/vda2` vfat，约 197M |
| 负载 | 接近空闲（记录时 load ≈ 0） |

### 3.3 网络与监听端口（记录时）

| 端口 | 协议 | 服务 | 说明 |
|------|------|------|------|
| 22 | TCP | sshd | SSH 管理 |
| 80 | TCP | nginx | HTTP，301 到 HTTPS |
| 443 | TCP | nginx | HTTPS（Let's Encrypt） |

本机防火墙 `ufw`：**inactive**（未启用）。实际出入站还需看阿里云安全组是否放行 22/80/443。

网卡：

```text
lo     127.0.0.1/8
eth0   172.30.33.212/20   UP
```

### 3.4 已安装/运行的主要服务

| 服务 | 状态 | 说明 |
|------|------|------|
| `sshd` | 运行中 | SSH |
| `nginx` | active / enabled | Web 站点 + SSL |
| `certbot.timer` | enabled | Let's Encrypt 自动续期 |
| Docker | 未安装/未使用 | — |

站点目录：`/var/www/fanavatar.org`  
Nginx 配置：`/etc/nginx/sites-enabled/fanavatar.org`

### 3.5 当前角色定位

这是一台较干净的新加坡轻量 ECS：已完成域名解析、Nginx、HTTPS。目前首页为占位静态页，尚未部署业务应用。适合继续挂站、反代、API 等。

---

## 4. 域名信息（Spaceship）

| 项目 | 值 |
|------|-----|
| 域名 | fanavatar.org |
| 到期日期 | 2027-05-25 |
| 自动续费 | 开启 |
| Whois 隐私 | 私密（Private） |
| Spaceship 侧连接 | 未连接主机/邮箱等产品（显示「+ 连接」） |
| 管理入口 | https://www.spaceship.com/zh/application/domain-list-application/ |
| 高级 DNS | https://www.spaceship.com/zh/application/advanced-dns-application/manage/fanavatar.org/ |

说明：Spaceship 仅作为**域名注册商**。权威 DNS 不在 Spaceship，而在 Cloudflare（自定义名称服务器）。

---

## 5. DNS / Cloudflare 配置

### 5.1 账号与 Zone

| 项目 | 值 |
|------|-----|
| Cloudflare 账号 | Stoneworkerstock@gmail.com |
| Account ID | `526ca3b0d525910a5cdd6b9edf30f7bb` |
| Zone | fanavatar.org |
| Zone ID | `bd854fecbaf7b0c2bdc1cc165f3bf379` |
| 套餐 | Free |
| Zone 状态 | active |
| DNS Setup | Full（Cloudflare 为权威 DNS） |
| 控制台 | https://dash.cloudflare.com/526ca3b0d525910a5cdd6b9edf30f7bb/fanavatar.org |

### 5.2 名称服务器（权威 NS）

- `ainsley.ns.cloudflare.com`
- `elias.ns.cloudflare.com`

### 5.3 DNS 记录（当前）

| 类型 | 名称 | 内容 | Proxy | 说明 |
|------|------|------|-------|------|
| A | fanavatar.org | **47.84.61.45** | DNS only（灰云） | 根域指向新加坡机 |
| CNAME | www.fanavatar.org | fanavatar.org | DNS only | www 跟随根域 |
| MX | fanavatar.org | route1/2/3.mx.cloudflare.net | — | Cloudflare Email Routing（历史扫描保留） |
| TXT | fanavatar.org | `v=spf1 include:_spf.mx.cloudflare.net ~all` | — | SPF |
| TXT | cf2024-1._domainkey.fanavatar.org | DKIM 公钥 | — | Email Routing DKIM |

> Proxy 保持 **DNS only**，便于 Let's Encrypt HTTP-01 直连源站校验。若以后改橙云，需改用 DNS-01 或 Cloudflare Origin Certificate。

### 5.4 解析验证

```text
dig +short fanavatar.org A @1.1.1.1
47.84.61.45

dig +short www.fanavatar.org A @1.1.1.1
fanavatar.org.
47.84.61.45
```

---

## 6. HTTPS / Let's Encrypt

| 项目 | 值 |
|------|-----|
| Web 服务器 | Nginx 1.18.0 |
| 站点根目录 | `/var/www/fanavatar.org` |
| Nginx 配置 | `/etc/nginx/sites-enabled/fanavatar.org` |
| 证书 | `/etc/letsencrypt/live/fanavatar.org/fullchain.pem` |
| 私钥 | `/etc/letsencrypt/live/fanavatar.org/privkey.pem` |
| 签发机构 | Let's Encrypt (YR2) |
| 覆盖域名 | `fanavatar.org`, `www.fanavatar.org` |
| 生效 | 2026-08-06 |
| 过期 | 2026-11-04 |
| HTTP | 301 → HTTPS |
| 自动续期 | `certbot.timer` 已启用 |
| 申请邮箱 | stoneworkerstock@gmail.com |

访问地址：

- https://fanavatar.org/
- https://www.fanavatar.org/

手动续期测试：

```bash
certbot renew --dry-run
```

---

## 7. 操作时间线

1. 连接新加坡 ECS，配置本机 SSH 公钥免密登录。
2. Spaceship 发现域名 `fanavatar.org`，NS 在 Cloudflare。
3. 将 zone 接入 Cloudflare 账号 `Stoneworkerstock@gmail.com`。
4. A 记录改为 `47.84.61.45`（DNS only）；www CNAME 到根域。
5. 安装 Nginx，配置站点。
6. `certbot --nginx` 签发并部署 Let's Encrypt 证书，开启 HTTP→HTTPS 跳转。
7. 本文档写入本机 `服务器/` 与服务器 `/fanavatar.org-setup.md`。

---

## 8. 后续建议

1. 按业务部署应用（替换 `/var/www/fanavatar.org` 静态页或加反向代理）。
2. 不用 Cloudflare Email Routing 时可清理 MX/SPF/DKIM。
3. 修改曾暴露过的 root 密码；稳定后可关密码登录。
4. 若开 Cloudflare 橙云，记得调整 SSL 模式与证书策略。
5. 确认阿里云安全组长期放行 22/80/443（按需收紧来源 IP）。

---

## 9. ID 速查

```text
Domain:          fanavatar.org
Public IP:       47.84.61.45
SSH:             ssh -i ~/.ssh/id_ed25519 root@47.84.61.45
Aliyun Region:   ap-southeast-1 (Singapore)
Aliyun Zone:     ap-southeast-1b
Instance ID:     i-t4n8d1ikyz785yqbzk2u
CF Account ID:   526ca3b0d525910a5cdd6b9edf30f7bb
CF Zone ID:      bd854fecbaf7b0c2bdc1cc165f3bf379
Cert path:       /etc/letsencrypt/live/fanavatar.org/
Local doc:       E:\angsa\angsa_data\Games\JourneyWestGreatBrawl\服务器\fanavatar.org-setup.md
Server doc:      /fanavatar.org-setup.md
```
