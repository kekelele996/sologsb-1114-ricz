# 洞穴测绘草图编目台（gbcavesurvey）

面向洞穴测绘小组测量记录员的本地化编目台：把「洞段 → 测点方位/倾角/距离读数 → 草图 → 图幅拼合」串成一条可回溯的链路，解决手写记录散落、闭合导线误差看不出来、多张草图拼接对不上桩号的问题。**纯前端单页应用**，全部数据保存在浏览器 IndexedDB，不依赖任何后端服务或外部接口。

## 一、Docker 一键启动（推荐）

```bash
cp .env.example .env      # 首次启动先复制环境变量文件
docker compose up -d --build
```

启动后访问：<http://localhost:21814>

常用命令：

```bash
docker compose ps          # 查看容器状态
docker compose logs -f     # 查看日志
docker compose down        # 停止并移除容器（数据在浏览器本地，不受影响）
```

端口与项目名可在 `.env` 中调整：

```
COMPOSE_PROJECT_NAME=gbcavesurvey
FRONTEND_PORT=21814
```

## 二、技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3（Composition API） |
| 语言 | TypeScript（`vue-tsc` 类型检查零错误） |
| UI 组件库 | Element Plus |
| 状态管理 | Zustand（`zustand/vanilla` createStore + Vue 响应式桥接） |
| 路由 | Vue Router 4（History 模式，nginx `try_files` 回落） |
| 构建 | Vite 6 |
| 本地存储 | IndexedDB（Dexie 封装，含 `schemaVersion` 与升级迁移） |
| 部署 | 多阶段 Dockerfile：`node:20-alpine` 构建 → `nginx:alpine` 托管 |

## 三、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:21814
npm run build      # 类型检查 + 生产构建
```

> 本地开发无需任何后端服务或环境变量。

## 四、目录结构

```
sologsb-1114/
├── docker-compose.yml          # 顶层 name: gbcavesurvey，无 version 字段
├── .env.example                # COMPOSE_PROJECT_NAME / FRONTEND_PORT
├── frontend/
│   ├── Dockerfile              # 多阶段构建，nginx 阶段 chmod -R a+rX 静态资源
│   ├── nginx.conf              # try_files 前端路由回落 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/              # cave.ts / segment.ts / station.ts / sketch.ts / index.ts
│       ├── stores/             # caveStore / segmentStore / stationStore / sketchStore（Zustand）
│       ├── components/common/  # SegmentTag / BearingInput / ClosureBadge / GridCanvas
│       ├── hooks/              # usePersistentStore / useClosureCheck
│       ├── pages/              # CavesPage / SegmentsPage / StationsPage / SketchPage / MergePage
│       ├── router/index.ts
│       └── utils/              # survey.ts / export.ts / id.ts
```

## 五、数据模型与存储

| 模型 | 说明 | Dexie 表 |
| --- | --- | --- |
| Cave 洞口台账（普查登记室） | 归属根节点：洞名、行政区、经纬度、**洞口点名、海拔、接测水准点/水准点海拔**、发育层位、已知总长、负责人等 | `caves` |
| Segment 洞段（测量小组） | 起止桩号、类型（竖井/廊道/厅堂/裂隙/水道）、平均宽高、是否闭合、**认领洞口点名、接测高差、累计垂距、基准状态与成果高程** | `segments` |
| Station 测点 | 方位角、倾角、斜距 → 自动推算水平距/垂距，累计闭合差；现场读数原样保留，基准重算不改读数 | `stations` |
| Sketch 草图 | 格数、比例、绘制人、拼合顺序号、桩号对齐锚点 | `sketches` |

- 数据库名 `gbcavesurvey`，`meta` 表保存 `schemaVersion`；
- `version(2)` 升级迁移会把旧版测点记录由「斜距 + 倾角」补齐 `horizontalDistance` / `verticalDistance`；
- `version(3)` 引入洞口台账与洞内成果的**高程基准对账**（详见第八节）：旧洞段没有接测基准，升级时按当时洞口海拔回填，回填不上的标为「待确认回填」单列；
- 数据仅存于浏览器本地，容器无状态、不挂载命名卷，清除浏览器数据即清空。

## 六、主要页面

| 路由 | 功能 |
| --- | --- |
| `/caves` | 洞穴清单：卡片展示实测/已知总长、洞段数、最近测量日期，支持新建、编辑、归档、删除（删除前校验下级洞段数） |
| `/segments` | 洞段编目表：按桩号区间/类型/洞穴/基准状态筛选，批量调整类型与闭合标记；洞口点名对账、单段高程重算/重试、旧洞段补海拔确认，自动累计总长 |
| `/stations` | 测点读数录入：方位角/倾角专用输入（度分秒 ⇄ 十进制度），自动推算水平距垂距，实时闭合差徽标，异常读数整行高亮，支持连续录入下一站 |
| `/sketch` | 草图工作台：坐标纸网格上绘制测点折线、标注桩号与倾角箭头，支持草图基准方位旋转与草图记录管理 |
| `/merge` | 图幅拼合视图：拖动图幅按相邻边缘吸附、按桩号锚点一键对齐，输出可调整的拼合顺序表并支持 CSV 导出 |

## 七、计算约定

- 水平距 = 斜距 × cos(倾角)，垂距 = 斜距 × sin(倾角)；
- 闭合差 f = √(ΣΔE² + ΣΔN²)，默认阈值 0.25 m，超限时徽标变红并可展开计算过程；
- 方位角范围 0°–360°，倾角范围 -90°–90°，越界读数会被标记为异常。

## 八、洞口台账与洞内成果对账（v3）

洞口资料与洞内成果分两摊保管，按**洞口点名**对账：

- **普查登记室（`caves`）**：洞口点名 `entranceCode`、洞口海拔 `altitude`、接测水准点 `datumBenchmark` 与水准点海拔 `benchmarkAltitude`；接测高差 = 洞口海拔 − 水准点海拔。
- **测量小组（`segments` + `stations`）**：测点读数原样保留，累计垂距 `cumulativeVertical` 由各测点垂距（带符号）累计，洞段成果高程只在认基准后给出。

洞段基准状态四态流转：

| 状态 | 含义 | 去向 |
| --- | --- | --- |
| 已认基准 `confirmed` | 两边高差相符（容差 ±0.1 m），基准归属按登记室水准点结论落账 | 登记室改海拔/换接测点后 → 待高程重算 |
| 待高程重算 `stale` | 旧基准算出的成果已失效，被自动挑出 | 用现场读数重算后只重试本段对账 |
| 待核 `pending` | 点名对不上、高差超差或缺一边数据 | 等登记室水准点结论；对账失败只重试这一个洞段 |
| 待确认回填 `unbackfilled` | 旧数据升级时连当时洞口海拔都回填不上 | 登记室确认海拔后手动补基准并重试 |

规则要点：

1. 登记室改过洞口海拔或换了接测点，该洞口下**已认基准**洞段自动挂「待高程重算」，待核/待回填洞段维持原状，测点读数一律不动；
2. 对账按洞口点名匹配；接测高差与累计垂距差超过 ±0.1 m（或任一边缺失）挂待核，基准归属以登记室水准点结论为准；
3. 全量对账只重试「待重算/待核」洞段——**已按新基准认过的洞段不跟着回退**；行内可单段「重算 / 重试对账」；
4. v3 升级时旧洞段按当时洞口海拔回填（水准点留空），回填不上的单列 `unbackfilled`，在洞段编目页「补海拔确认」。
