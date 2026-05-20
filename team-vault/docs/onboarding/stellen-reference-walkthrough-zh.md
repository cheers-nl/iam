# 中文详解：从 Stellen 的 GroupSecret 功能到 AWS Team Vault Lite 的设计蓝图

> 生成于 2026-05-12。Lawyer 清关：用户在 2026-05-12 的 handoff-execution session 中确认。
> 本文是 `stellen-reference-analysis.md` 的中文配套讲解，面向没有 AWS / IAM 经验的读者。
> 与 analysis 一样，本文位于任何 git tree 之外。**不要 commit、不要 push、不要复制到 broker repo。**
> 文中所有 `backend/...` 之类的文件路径，相对的是 Stellen 项目仓库的根目录。

---

## 目录

- **第一部分**：先讲清楚 Stellen 那个"团队密码保险箱"功能是什么、为什么这么实现
- **第二部分**：看报告之前你必须先理解的 AWS / IAM 基础概念
- **第三部分**：逐节走 `stellen-reference-analysis.md` 那份报告
- **第四部分**：你接下来该怎么用这份报告

---

# 第一部分：Stellen 的 GroupSecret 功能从头讲一遍

## 1.1 这个功能想解决什么问题（产品视角）

设想一个团队（比如某社团、某创业团队）共享一些"账号"：
- 一个 Stripe 后台账号
- 一个 SendGrid 邮件账号
- 一个 Instagram 账号
- ……

**痛点**：密码怎么共享给团队成员？发 Slack？写 Notion？发邮件？这些方式都有问题：
- 一旦发出去就回不来（前同事的 Slack 里还留着）
- 没有审计 —— 你不知道谁看过、什么时候看过
- 没法做"只有管理员能看，普通成员看不到"的权限分级

GroupSecret 就是 Stellen 内置的一个**简易团队密码保险箱**：管理员可以把一个账号的"用户名提示 + 加密的密码 + 一些备注"存进数据库，团队里其他管理员可以点"显示密码"按钮才能看到明文，每一次显示都被记录下来。

这就是为什么我在报告里把它叫做 Team Vault Lite 的**直接灵感来源** —— 它做的事和 Team Vault Lite 要做的事在产品上几乎一模一样，差别只在于底层用什么技术实现。

## 1.2 用户实际看到的东西（功能视角）

- **管理员**：能创建一条 secret（输入：标题、登录 URL、用户名提示、密码本身、备注）；能查看自己组的所有 secret 列表（但默认看不到密码明文）；能点"reveal"显示密码。
- **普通成员**：能看到 secret 列表的元数据（标题、URL），但**不能 reveal** —— 后端会拒绝。
- **一切 reveal 都被记录**：哪个用户、什么时间、reveal 了哪个 secret。

## 1.3 数据库里存了什么（数据模型）

打开 `backend/prisma/schema.prisma:414`，你会看到两个 Prisma 模型（对应 Postgres 的两张表）：

### GroupSecret 表（存放被加密的密码）

```
id               一条 secret 的唯一 ID（cuid 生成）
groupId          这条 secret 属于哪个组（决定谁能看）
title            标题，比如 "公司 Stripe 主账号"
category         分类（GENERAL、PAYMENT、SOCIAL 等枚举）
loginUrl         登录链接
usernameHint     用户名提示（明文,不加密 —— 用户名本身不算敏感）
accountOwnerNote 账号主人备注
recoveryNote     找回密码的备注
encryptedValue   ★ 加密后的密码本体(base64 字符串)
iv               ★ 加密用的初始化向量(base64 字符串)
authTag          ★ 加密生成的认证标签(base64 字符串)
algorithm        用的算法（默认 "aes-256-gcm"）
keyVersion       密钥版本号(默认 1，理论上支持轮换 —— 但代码里从没轮换过)
createdById      谁创建的
createdAt        创建时间
updatedAt        更新时间
```

打星号的三个字段（`encryptedValue`、`iv`、`authTag`）是加密的核心 —— 我后面专门讲。

### GroupSecretAccessLog 表（审计日志）

```
id              日志条目 ID
groupSecretId   被 reveal 的是哪条 secret
viewerUserId    谁 reveal 的
action          目前永远是 "REVEAL"
createdAt       什么时间 reveal 的
```

每次有人点"显示密码"，就插入一行。**注意**：只记录 REVEAL，不记录"创建了一条 secret"、"删除了一条 secret"、"列了一下 secret 列表"。这是后面我会指出的一个缺陷。

## 1.4 加密到底是怎么做的（最关键的一节）

打开 `backend/utils/groupSecretCrypto.js`，这个文件只有 67 行，但它是整个保险箱的"心脏"。

### 先讲 AES-256-GCM 是什么

- **AES**：高级加密标准，目前业界最常用的对称加密算法。
- **256**：使用 256 位（32 字节）的密钥。
- **GCM**：一种"认证加密"模式 —— 加密的同时会生成一个"认证标签"（authTag）。解密时如果数据被篡改过哪怕一个 bit，authTag 校验就失败、解密就报错。这是它比"AES-CBC"那种老模式更安全的地方。

**对称加密**的意思是：**加密和解密用同一把钥匙**。这跟你登录网银用的非对称加密（公钥加密、私钥解密）不一样。

### IV 是什么、为什么每次都要新生成

IV = Initialization Vector，初始化向量。

直观理解：哪怕你用同一把钥匙加密两次同样的明文，**如果用同一个 IV，加密结果会一样**。这是个安全问题（攻击者能看出"哦这两条密码是同一个"）。所以 GCM 模式要求**每次加密都用一个新的、随机的 IV**。

代码里这一行就在做这个：
```
const iv = crypto.randomBytes(12);   // 生成 12 字节随机 IV
```

GCM 标准规定 IV 是 12 字节。

### 整个加密流程

```
函数 encryptSecretValue(明文密码):
    1. 从环境变量 GROUP_SECRET_KEY 读出密钥（必须是 32 字节）
    2. 生成一个 12 字节随机 IV
    3. 用 AES-256-GCM 算法、用密钥+IV 加密明文
    4. 算出 authTag
    5. 把 密文、IV、authTag 都转成 base64 字符串
    6. 返回这三个字符串 + 算法名 + 密钥版本号
```

存数据库时，这三个 base64 字符串各自占一列。

### 解密流程

```
函数 decryptSecretValue(数据库里的行):
    1. 还是从 GROUP_SECRET_KEY 读密钥
    2. 用同样的算法、同样的密钥、把 IV 还原成字节
    3. 设置 authTag（用来校验完整性）
    4. 解密密文
    5. 如果中途任何一步对不上（密钥错了、密文被改了、authTag 不对），就抛错
    6. 返回明文密码
```

### 关键问题：那把密钥本身存在哪里？

**存在环境变量里**（`process.env.GROUP_SECRET_KEY`）。

具体说：
- 开发环境：写在 `.env` 文件里
- 生产环境：写在 Vercel（部署平台）的 Environment Variables 配置面板里

代码加载时把这个字符串解析成 32 字节的 Buffer，常驻 Node.js 进程内存。

**这是这个设计的核心局限**，也是 Team Vault Lite 整个项目存在的原因：
- 这把密钥就一个，没有轮换机制
- 它跟应用进程在同一个安全边界里 —— 谁能看到环境变量谁就能看到密钥
- 没有审计 —— 谁、什么时候用过这把密钥，没有日志（数据库里的 access log 记的是"谁 reveal 了 secret"，不是"谁用了密钥"）
- 它没有"被限制只能用在 X 服务上"的能力

AWS 的 KMS（Key Management Service）解决的就是这些问题。这是第二部分要展开讲的。

## 1.5 "Reveal 一条 secret" 的完整请求生命周期

这是把上面所有东西串起来的地方。当用户在前端点了"显示密码"按钮，到拿到明文密码，中间经过了什么？

代码在 `backend/routes/groupAccount.js:2363`。

```
POST /:groupId/secrets/:secretId/reveal
```

中间件链：`authGuard` → `requireGroupAdmin` → 路由处理函数

### 第 1 关：authGuard（身份验证）

代码在 `backend/middleware/auth.js:10`。

它做三件事：
1. 从请求里掏出 token —— 优先从 `Authorization: Bearer xxx` 头里拿，没有就从 `req.cookies.token` 拿
2. 用 `process.env.JWT_SECRET` 验证 JWT 签名是否合法 + 是否过期
3. 把 token 里解出的用户信息塞到 `req.user` 上

JWT 本质上就是一段被签名的 JSON。前端登录时后端发一个；之后每次请求带上它就证明"我是登录过的某某用户"。无状态、不需要后端存 session。

**如果第 1 关失败**：返回 401 Unauthorized，整个请求结束，永远不会进到下一关。

### 第 2 关：requireGroupAdmin（权限检查）

这一关检查：`req.user.id` 这个人，是不是 `groupId` 这个组的管理员？

它会查 `GroupMember` 表，看这个用户对这个组的 `role` 字段是不是等于 `"ADMIN"`。

**特殊规则**：如果 `userId === groupId`（用户的 ID 和组 ID 相同），直接返回 true。这是 Stellen 里"个人即组织"的一种约定 —— 一个独立的人也能开一个"组"账户，自己就是自己的管理员。这点我在报告 §9 里专门列了出来要问你。

**如果第 2 关失败**：返回 403 Forbidden。

### 第 3 关：路由处理函数本身

到了这里，我们已经确认：
- 是一个合法登录的用户
- 是这个组的管理员

但代码**还做了第三层防御**：

```js
const secret = await prisma.groupSecret.findFirst({
  where: { id: secretId, groupId },   // ← 这里同时限定 id 和 groupId
  ...
});
```

也就是说：**就算前两关都被绕过了**（比如代码 bug，把 ADMIN 检查误判成 true），这个查询本身也保证你只能拿到属于这个 `groupId` 的 secret。如果你试图用 A 组管理员的身份去 reveal B 组的 secret，`findFirst` 会因为 `groupId` 对不上而返回 null，请求就 404 了。

**这就是"纵深防御"（defense in depth）**：每一层独立有效，多层叠加。

### 拿到行之后:解密 + 记录日志 + 返回

```js
const plainValue = decryptSecretValue(secret);   // ← 解密

await prisma.groupSecretAccessLog.create({       // ← 写审计日志
  data: { groupSecretId, viewerUserId: req.user.id, action: "REVEAL" }
});

return res.json({ ok: true, revealedValue: plainValue });  // ← 返回给前端
```

### 这里有个微妙的 bug —— 我在报告里提到的"竞态窗口"

`decryptSecretValue(secret)` 和 `prisma.groupSecretAccessLog.create({...})` 是两个独立的语句。如果在这两行**之间**网络挂了、进程崩了、超时了 —— 用户已经拿到明文了，但日志没写。

技术上不是漏洞（用户本来就有权 reveal），但是审计的角度是个缺口：你以为日志能告诉你"所有 reveal 过的事件"，其实它能告诉你"所有 reveal 过且事后日志写入成功的事件"。

AWS 的 CloudTrail 会自动记录所有 KMS Decrypt 调用，**这个竞态窗口在 KMS 上不存在** —— 因为日志是 AWS 平台层面强制写的，不是应用代码自己写的。这是 Team Vault Lite 用 KMS 替代自建加密能拿到的一个"白送的"安全提升。

---

到这里 Stellen 那部分讲完了。**现在你应该能回答**：
- GroupSecret 这个功能是干嘛的
- 数据怎么存的
- 加密怎么做的
- 一次 reveal 请求经过哪几关
- 这个设计有什么局限

接下来我要讲 AWS / IAM 的基础概念，再用这些概念回过头看报告。

---

# 第二部分：看报告之前你必须先理解的 AWS 基础

我只讲跟 Team Vault Lite 直接相关的概念，不展开 AWS 全貌。

## 2.1 什么是 IAM

IAM = **Identity and Access Management**（身份和访问管理）。AWS 上**每一个动作**都需要明确的权限。读一个 S3 文件、调一次 KMS 解密、启动一个 Lambda 函数 —— 都得有"谁、能做什么、对什么资源"这三件事都被允许才行。

类比：你公司里"小王能在 9 点到 18 点之间打开 3 楼的会议室门"，IAM 就是写下并执行这条规则的系统。在 AWS 里这条规则用一种叫 **policy（策略）** 的 JSON 文档表达。

## 2.2 主体（Principal）、动作（Action）、资源（Resource）

每条 IAM 规则都是关于这三件事的：
- **主体**（Principal）：谁。可以是一个 IAM 用户、一个 IAM 角色、一个 AWS 服务（"Lambda 服务自己"）。
- **动作**（Action）：做什么。比如 `s3:GetObject`、`kms:Decrypt`。
- **资源**（Resource）：对什么东西做。比如某个特定 S3 桶、某个特定 KMS 密钥。

还可以加**条件**（Condition）：什么时候允许 / 拒绝。比如"只在 IP 是公司网段时允许"、"只在被打了 `team=alpha` 标签的资源上允许"。

## 2.3 身份策略 vs 资源策略 —— 双重授权模型

这是 IAM 最让人困惑的一点，也是报告 §4 表里反复出现的概念。

**身份策略**（identity policy）：附在一个**主体**身上的规则。说的是"**我**能做什么"。
- 例：附在 Lambda 函数的"执行角色"上 → "我可以调 KMS Decrypt"

**资源策略**（resource policy）：附在一个**资源**身上的规则。说的是"**谁**能用我"。
- 例：附在 KMS 密钥上的"密钥策略" → "Lambda-XYZ 可以调我做 Decrypt"

**关键规则**：**两边都说允许才算允许，任一边说拒绝就拒绝**。

这意味着如果你给 Lambda 的身份策略加了 `kms:Decrypt`，但忘了在 KMS 密钥策略里把这个 Lambda 加为允许的主体 —— **你会被拒绝**。反过来也一样。

**这就是为什么 KMS 是新手最大的痛点**：你以为"我给 Lambda 加了 Decrypt 权限"就够了，但密钥那边还得"独立地"允许 Lambda 来访问。两边的列表要同步。

报告 §4 那张表的最上面几行、§5 第 5 天的痛点预测，整个都是在围绕这个双重授权模型在展开。

## 2.4 KMS 是什么、信封加密是什么

**KMS**（Key Management Service）= AWS 的"密钥保险柜"。

它解决了 Stellen 那把 `GROUP_SECRET_KEY` 的所有问题：
- 你**永远拿不到密钥本身**。你只能向 KMS 发"用这把密钥帮我加密这段数据"或"帮我解密"这种请求。
- 密钥被 AWS 用专门的硬件（HSM，硬件安全模块）保管。
- 每一次"用这把密钥"的调用，CloudTrail 自动记录 —— 谁、什么时候、用哪个密钥、加密还是解密、对哪个资源。这就是"白送的审计"。
- 密钥可以配置**自动每年轮换**。AWS 后台帮你处理旧密文继续可解的问题。

**但是**：KMS 有个性能限制 —— 一秒钟只能加密最多 4KB 数据，而且每次都有网络延迟。所以你不会拿 KMS 直接加密 100MB 的文件。

**信封加密**（envelope encryption）就是绕开这个限制的标准做法：

```
写数据时：
  1. 让 KMS 生成一个"数据密钥"(data key) —— KMS 返回两份：明文版+加密版
  2. 用明文数据密钥在你的 Lambda 内存里加密真正的数据(用 AES-GCM，跟 Stellen 一样)
  3. 把加密后的数据 + 加密版的数据密钥 一起存到 DynamoDB
  4. 把明文数据密钥从内存里清掉

读数据时：
  1. 从 DynamoDB 取出加密的数据 + 加密版的数据密钥
  2. 让 KMS 用主密钥把"加密版的数据密钥"解开，拿回明文版
  3. 用明文数据密钥解密真正的数据
  4. 用完再清掉明文数据密钥
```

**关键点**：每次写数据需要调 `kms:GenerateDataKey`；每次读数据需要调 `kms:Decrypt`。**这是两个不同的权限**，给一个不给另一个，你的应用就会半瘫痪。这就是报告 §4 表里那一行说的事。

## 2.5 Cognito 是什么 —— Stellen 那套 JWT 在 AWS 上的替代品

Stellen 用 `jwt.sign(payload, JWT_SECRET, ...)` 自己签 JWT。Cognito 是 AWS 提供的"开箱即用的用户系统"，能替你处理：
- 用户注册 / 登录 / 找回密码
- 邮箱、短信验证
- 第三方登录（Google、Apple 等）
- 颁发 JWT（用它自己的密钥签名，你不用管）

**但 Cognito 有两种东西名字非常像**：

**User Pool**（用户池）：身份提供者。它知道"小王这个人存在、密码是什么"。它给你颁发 JWT。

**Identity Pool**（身份池）：STS 凭证经纪人。它把 User Pool 的 JWT（或者 Google 颁发的 JWT、或者 Apple 颁发的 JWT）换成"临时 AWS 凭证"，让浏览器可以直接调 AWS API（比如直接上传到 S3）。

**新人 100% 会混淆这两个**。报告里第 3 天的痛点预测专门提到了这点。Team Vault Lite 在第 3 天就会撞上。

## 2.6 OIDC 联邦 vs 静态密钥

Stellen 的 S3 调用是怎么获得 AWS 凭证的？看 `backend/s3.js`：

```js
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});
```

这是**静态访问密钥** —— 一对永久有效的 ID + Secret，写在环境变量里。

**为什么这很糟**：
- 永久有效。万一泄露（推到公共仓库、写进日志），需要紧急轮换。
- 没有"自动过期"概念。
- 你没法知道这对密钥在哪些机器上、被复制了几份。

**AWS 现代的做法**：
- **人**（开发者）：用 Identity Center SSO 登录，AWS CLI 每次会自动获取**几小时有效的临时凭证**。
- **CI/CD**（GitHub Actions）：通过 **OIDC 联邦**让 GitHub 直接换 AWS 临时凭证（不放任何长期密钥）。这是 §3 里说的"理解之后最受欢迎的特性"。
- **Lambda / EC2 等 AWS 内部服务**：用"执行角色"。代码里完全不写凭证，SDK 自动从元数据服务取临时凭证。

**Team Vault Lite 的目标之一：整个项目里不出现一次 `AWS_SECRET_ACCESS_KEY`**。

## 2.7 CDK 是什么 —— Infrastructure as Code

CDK = Cloud Development Kit。用 TypeScript 描述"我要的 AWS 资源是什么"，运行 `cdk deploy` 后它会替你创建/更新对应的 AWS 资源。

为什么用 CDK 而不是手工点控制台：
- 可以 git 管理基础设施
- 同样的栈可以一键复制（开发环境、生产环境）
- 你的 PR 评审者能看到基础设施的变化

**但 CDK 第一次跑会让人崩溃**：它要求你先做一次 `cdk bootstrap`，这会创建 5 个 IAM 角色，每个都有特定用途，但 CLI 输出里什么都不解释。这是第 2 天的预定痛点。

---

到这里 AWS 基础讲完了。**你现在应该能理解**：
- 为什么 KMS 比环境变量里那个 32 字节密钥强
- 为什么"密钥策略 + 身份策略"会是大坑
- 为什么要用 Cognito 而不是自签 JWT
- 为什么要用 OIDC 而不是静态 AWS 密钥

接下来开始走 `stellen-reference-analysis.md` 那份报告。

---

# 第三部分：报告章节逐条讲解

## §1 TL;DR（核心要点）

这一节就一段话，告诉读者整个报告的目的。

**含义**：Team Vault Lite 就是把 Stellen 的 GroupSecret 模式"AWS 化"。报告 §4 那张映射表是设计的脊柱 —— 每一行就是一个具体的架构决定。

## §2 GroupSecret 模式深度剖析

**这一节我在第一部分讲过了**。回看 1.3 / 1.4 / 1.5。这里只补充几个报告里写但口头没强调的点：

### "三层防御"为什么重要

第 1.5 节里讲的"authGuard → requireGroupAdmin → 查询 where 条件"这三层，每一层都是**独立有效**的防御。即使其中一层因为 bug 失效了，其他两层还能挡住。这种思想在 AWS 里依然成立 —— 你会看到我在 §4 的映射表里建议**保留**这种纵深防御理念，只是把每一层换成 AWS 的对应物（Cognito authorizer → IAM 条件键 → DynamoDB partition key 隔离）。

### 写日志的竞态窗口

1.5 末尾讲过，CloudTrail 在 KMS 这层自动记录，避免了"代码忘记记日志"或"记日志失败但操作成功"的情况。

## §3 其他安全相关的模式

这一节是把 Stellen 里**所有跟安全沾边的代码**都过了一遍，不止 GroupSecret。

### §3.1 第二套加密模块（`secretBox.js`）

Stellen 还有**另一个**加密模块，专门用来加密 Calendly 的 OAuth token。它跟 GroupSecret 的加密**不是同一个模块**，也不用同一个密钥。

两套模块做几乎同样的事，但实现方式不同：
- GroupSecret：密钥是 32 字节 raw buffer；密文/IV/authTag 分三列存
- secretBox：把 string 密钥用 SHA-256 派生一次；密文用 `v1.<iv>.<authTag>.<密文>` 这种点分单字段存

**这是个工程债**：两套差不多的代码并存。但报告里我标出来的更严重问题是下一节那条。

### §3.1 里那个开发环境的"危险后门"

`secretBox.js:13` 写了：

```js
if (NODE_ENV !== "production") {
  return process.env.JWT_SECRET;   // ← 退回用 JWT_SECRET
}
```

**意思**：如果你没配 `CALENDLY_TOKEN_ENCRYPTION_SECRET` 这个环境变量，又不在生产环境，代码会**用 `JWT_SECRET` 当加密密钥**。

为什么糟糕：**一个密钥不应该同时承担两种用途**。`JWT_SECRET` 是用来签 JWT 的；如果它同时还在加密 token，那一旦泄露，**两件事同时完蛋** —— 攻击者既能伪造 JWT，又能解密所有存档的 OAuth token。

这种叫"密钥复用反模式"（key reuse antipattern）。

**Team Vault Lite 用 KMS 后**：这种问题在结构上就不可能出现，因为 KMS 上签名密钥和加密密钥是**完全不同类型**的密钥，你想把签名密钥拿去加密都做不到。

### §3.2 身份验证（auth）

总结 Stellen 的认证设计：
- 完全无状态 JWT —— 后端不存 session
- token 可以从 `Authorization` 头 **或** cookie 里来（两个来源都接受）
- 一个 `JWT_SECRET` 签所有 token
- 默认 7 天有效期
- **没有刷新 token 机制** —— 7 天到了用户得重登
- **没有吊销机制** —— 如果一个 token 被偷了，在 7 天里你拿它没办法

Team Vault Lite 用 Cognito 替代这一整套。Cognito 自动处理刷新、撤销、JWKS 公钥验证等等。

### §3.3 权限检查（authorization）—— 命令式 vs 声明式

Stellen 的所有权限检查都是**命令式**的：在每个 route handler 里手动调函数（`await assertGroupAdmin(...)`，不通过就抛 403）。

AWS 的现代做法是**声明式**：写一个策略文档说"打了 `groupId=X` 标签的 Lambda 只能访问 partition key 是 X 的 DynamoDB 行"，剩下的 AWS 在运行时强制执行。

两种风格各有优劣，但**你的 Day 1 deck 里讨论这个对比会很有价值**。Kai 会喜欢看到你思考这个层面的设计权衡。

### §3.4 审计日志的缺口

只有 `GroupSecretAccessLog` 一张表，只记 REVEAL。**没记**：
- 创建 / 删除 secret
- 列 secret 列表（也是访问行为）
- 登录成功 / 失败
- 403 权限被拒事件
- 任何其他敏感操作

**这是个普遍问题**：自建的应用审计往往覆盖不全，因为开发者只在自己想到的地方加日志。

**AWS 的优势**：CloudTrail 自动覆盖**所有 API 调用**（包括 KMS Decrypt、DynamoDB GetItem 等），不需要开发者写一行代码。这是 §4 表里"GroupSecretAccessLog → CloudTrail data events"那一行的含义。

### §3.5 第三方凭证管理

那张表列了 Stellen 用到的所有第三方服务（Stripe、SendGrid、Daily.co、Twilio、Google、Outlook、Calendly、AWS S3、agent runtime 的 Ed25519 密钥）。

**共同模式**：每一个都是 `process.env.XXX_API_KEY`，每个模块加载时各自读一遍，没有任何统一管理、没有轮换。

AWS 上的现代做法是用 **Secrets Manager** 或 **Parameter Store** 集中管理这些第三方密钥，并支持自动轮换。但 **Team Vault Lite 里没第三方服务**（这是项目刻意设计的范围），所以这个问题不会在 Team Vault Lite 自身上出现 —— 但你应该在 pain log 里**预测**："如果未来要加第三方集成，AWS 提供的方案是什么？"

### §3.6 AWS S3 的使用 —— 你目前为止唯一的 AWS 接触面

报告里这句话很重要：

> *"This is **the only production AWS surface area in the entire prior project**"*

**翻译**：这套 S3 代码是 Stellen 项目里**唯一**的 AWS 生产使用。换句话说，你过去对 AWS 的所有实操经验，几乎全部都在这 42 行代码里。

而且这 42 行就用了**最差的 AWS 做法**：静态访问密钥写在环境变量里。

**Team Vault Lite 的一个核心使命**：让你彻底告别这种用法，学会"现代 AWS 凭证管理"是什么样的。

### §3.7、§3.8 Webhook 验签 / CORS / 缺失的限流

这些跟 Team Vault Lite 关系不大，扫一眼即可。但**限流缺失**那块值得在 pain log 里留一笔："AWS 上限流住在哪里？API Gateway usage plan？WAF？Cognito throttling？多个地方？"

## §4 模式 → AWS IAM 的映射表 —— **这是整份报告的核心**

这张表 13 行，每一行是一个具体的架构决定。我逐行讲。

**第 1 行**：`GROUP_SECRET_KEY` 环境变量 → KMS 客户管理的密钥（CMK）。  
- **意思**：把那个 32 字节 buffer 替换成 KMS 里的一个密钥。
- **预定痛点**：密钥策略 ↔ 身份策略的"双重授权"。这是整个 AWS 上**密度最高的痛点来源**。

**第 2 行**：`encryptSecretValue()` 函数 → 调用 `KMS.GenerateDataKey` 做信封加密。
- **意思**：写一条 secret 时，不直接把密码用 32 字节密钥加密；而是问 KMS 要一个一次性数据密钥，加密时用这个数据密钥，把加密过的数据密钥存数据库。
- **预定痛点**：`kms:GenerateDataKey` 和 `kms:Decrypt` 是**两个不同的权限**。第一次给 Lambda 加权限的时候 90% 概率只加一个、漏了另一个，然后下一次操作失败、你 debug 半天才发现。

**第 3 行**：`decryptSecretValue()` → `KMS.Decrypt` + GCM authTag 校验。
- **意思**：读 secret 时反过来。
- **预定痛点**：同上，加上"哪个角色能调 KMS"必须在密钥策略里**显式**加上。

**第 4 行**：`JWT_SECRET` → Cognito User Pool。
- **意思**：把自签 JWT 换成 Cognito 颁发的 JWT。
- **预定痛点**：选什么类型的 authorizer（Cognito authorizer / Lambda authorizer / IAM authorizer）？三种各自适合什么场景？

**第 5 行**：Bearer token 流 → Cognito 颁发的 JWT 走同样的 `Authorization` header。
- **预定痛点**：Cognito 颁发的 token 有两种 —— **ID token** 和 **access token**。API Gateway 的 Cognito authorizer 只接受其中一种（具体哪一种取决于配置）。挑错了就 401，但错误信息不会告诉你为啥。

**第 6 行**：`authGuard` 中间件 → API Gateway Cognito authorizer。
- **意思**：身份验证从你的 Node 代码移到 AWS 平台层。
- **预定痛点**：失去微调能力 —— 比如 Stellen 的 authGuard 还支持从 cookie 拿 token，API Gateway 标准 Cognito authorizer 不支持这种 fallback；OPTIONS 预检请求会绕过 authorizer（这是 CORS 怎么跟权限相互作用的一个反直觉之处）。

**第 7 行**：`requireGroupAdmin` 中间件 → Cognito 组 → IAM principal tag → DynamoDB 条件键。
- **意思**：把"这个用户是不是 ADMIN"从你的代码里查 GroupMember 表，换成 Cognito 把 group 信息写进 token，token 转成 IAM session tag，IAM 策略里用 tag 做条件检查。
- **预定痛点**：Cognito 的组**不是** IAM 的组；它只是 token 里的一个字符串标签。要把它真正变成 IAM 能用的 tag，必须经过 **Identity Pool**（不是 User Pool！），还要懂 `sts:TagSession` 这个细节。

**第 8 行**：`where: { id, groupId }` 查询级 tenant 隔离 → DynamoDB 条件键 `${aws:PrincipalTag/groupId}` 跟 partition key 比较。
- **意思**：把"代码里查询时带 groupId 条件"换成"IAM 策略不允许你访问 partition key 跟你的 tag 不一致的行"。
- **预定痛点**：DynamoDB 的设计哲学是"partition key 必须围绕你的访问模式（包括安全模式）来设计" —— 这跟关系数据库的设计哲学完全不同。

**第 9 行**：`GroupSecretAccessLog` 表 → CloudTrail data events for KMS Decrypt + DynamoDB Streams → Lambda → 审计表。
- **意思**：审计日志不再是应用代码自己写；改成 CloudTrail 自动捕获 KMS 调用（每次 reveal 都要调 KMS，所以 CloudTrail 会有记录），再加 DynamoDB Streams 抓数据变化送到一个专门的审计表。
- **预定痛点**：CloudTrail data events **要钱**。普通 management events 免费但只覆盖管理面调用；data events 覆盖数据面操作（GetObject、Decrypt 等）但按调用次数收费。第 5 天的实际成本计算会很有教育意义。

**第 10 行**：`ACL: "public-read"` → S3 私桶 + 签名 URL，并打开"Block Public Access"。
- **预定痛点**：S3 的访问控制有**四层叠加**（账户级 BPA、桶级 BPA、桶策略、ACL）。理解它们的优先级是 AWS 最让人困惑的部分之一。

**第 11 行**：硬编码 CORS 白名单 → API Gateway CORS 配置 + Cognito 应用客户端的允许回调 URL 列表。
- **预定痛点**：CORS + Cognito Hosted UI 的交互；OPTIONS 预检请求会绕过 authorizer。

**第 12 行**：AWS IAM 用户的静态访问密钥 → GitHub Actions OIDC（部署用）+ Lambda 执行角色（运行时）+ Identity Center SSO（人用）。
- **意思**：彻底告别 `AWS_SECRET_ACCESS_KEY`。
- **预定痛点**：OIDC 的信任策略里 `sub` 字段的格式很挑剔（`repo:owner/name:ref:refs/heads/main` 这种结构，少一个字符就不工作）。但 §3 handoff doc 里说，这是"理解之后最受欢迎的特性"。

**第 13 行**：Stripe webhook 验签 → 不迁移（Team Vault Lite 没有外部 webhook）。

## §5 不要带过去的反模式

8 个反模式。我在 §3 里讲过其中几个最关键的：
- 5.1 dev 环境用 `JWT_SECRET` 当加密密钥（密钥复用）
- 5.2 `keyVersion` 字段有但从不轮换
- 5.3 长期静态 AWS 密钥
- 5.4 命令式权限检查散落各处
- 5.5 S3 public-read ACL
- 5.6 审计只覆盖 REVEAL
- 5.7 三处独立的 S3 client 初始化（每处各自读一遍 env，没抽象）
- 5.8 没限流

**用法**：这一节是给 Day 1 deck 用的"我观察到的设计问题"清单。**但不要在 deck 里直接说"Stellen 有这些问题"**（handoff §5 的命名规则）—— 改成 "我从一个早期项目里学到了这些反模式" 之类的泛化表达。

## §6 痛点种子清单（最重要的使用守则）

这一节按 Day 1 - Day 7 列了**预测**会撞上的痛点。

**关键守则**：**这是"侦察雷达"，不是"剧本"**。

意思是：
- 你**实际撞上**了某个痛点 → 在 pain log 里用你自己的话记录、说清楚你当时想做什么、卡了多久、最后怎么解决的
- 你**没撞上**某个预测的痛点 → 不要补记进去。Kai 要的是你**真实**经历的摩擦，不是你抄一份预测清单
- 你撞上了**预测外**的痛点 → 一定记下来！这才是最有价值的内容，因为它说明 IAM 的痛点比已知地图还要广

为什么这么严格？因为 Kai 给这个 assignment 的本意（handoff §2）就是"你新人的视角能发现老 AWS 用户已经麻木的痛点"。**如果你不真实地体会这些痛点就照着我的清单抄**，你交出的 deck 在面试里经不起 Kai 追问 ——"你说 KMS 的 ViaService 条件键混乱，那你当时是怎么发现需要它的？"如果你没真撞过，没法答。

## §7 文件参考地图

只是给未来的 broker session 一个"想看代码可以去哪儿看"的目录。**不要把这些代码复制到 Team Vault Lite 仓库** —— handoff §5 的"零代码血缘"原则。

## §8 这份报告**不是**什么

- 不是迁移计划（Team Vault Lite 是全新写的，不是把 Stellen 港口过去）
- 不是详尽的代码评审（只覆盖 IAM 相关）
- 不是允许复制代码的授权（再次强调）
- 不能替代 handoff 文档（先读 handoff 再读这个）
- 不是 pain log（pain log 在 broker repo 里另写）

## §9 给你的开放问题

3 个我做分析时拿不准、想问你的问题：

1. **`keyVersion` 字段是真的想做轮换但没写完，还是一开始就是"aspirational"（想着但没规划好）？**
   - 影响：Team Vault Lite 的 DynamoDB schema 要不要也有这个字段。
   
2. **`secretBox.js` 退回 `JWT_SECRET` 的设计，是有意识的"dev 方便"还是疏漏？**
   - 影响：Day 1 deck 里要不要把它列为"反模式"。如果是有意识的方便，措辞要不同（"开发体验 vs 安全的权衡，我会建议用 LocalStack 之类的 AWS 模拟器替代"）；如果是疏漏，就是个清晰的反模式。

3. **`userId === groupId` 这条"用户即组"的特殊规则，是刻意的单人保险箱 UX，还是为了让某个特殊场景能跑通的临时 hack？**
   - 影响：Team Vault Lite 要不要支持单人 vault vs 多人团队 vault 两种模式，还是只做团队。

**这三个问题你可以现在直接回答**，或者放在脑子里等到撞到相关设计选择时再说。

---

# 第四部分：你接下来该怎么用这份报告

## 一句话总结

**这份报告是 broker session 的"设计速查表"，不是 Day 1 deck 的草稿**。

## 具体步骤

**现在（2026-05-12）**：
- 把这份报告**通读一遍**，确认你对每一节都能理解（如果有不懂的，问 Claude）
- 回答 §9 的三个问题（如果你想现在答）
- 决定 lawyer 的状况：你说已 cleared，所以这份分析就生效了；如果将来 lawyer 改口，我们再处理

**等 broker session 开起来时（理想情况下在 `~/Downloads/Git/aws-iam-broker/` 起一个新 Claude session）**：
- 那个 session 会读 handoff doc 和这份报告
- 然后开始 Day 1（开 AWS 账号、装 SSO 等）
- 撞上痛点就记 pain log
- 这份报告是它的设计参考；当它问"DynamoDB 这里该怎么设计 partition key？"我们就翻到 §4 第 8 行

**Day 1 deck 准备阶段（2026-05-25 左右）**：
- 你回过头来，从 pain log 里挑出最有故事性的 5-10 条
- 对照 §5 的反模式和 §4 的映射表，**给每个痛点配一个"如果 IAM 这么设计会不会更好"的建议**（这就是 Kai 说的 "suggestions" 部分）
- **不要直接搬这份报告里的措辞** —— Kai 想听到你的口吻，不是 Claude 的口吻

## 我自己的判断

这份报告比较"重"，密度高，一次读完可能有点累。但它**只需要写一次**；之后 broker session 和你都可以随时翻它。

如果某一节你觉得讲得不够清楚，单独问就行，我可以单独展开。

---

**中文详解结束。**
