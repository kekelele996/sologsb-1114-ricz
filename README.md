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
│       ├── types/              # cave.ts / segment.ts / station.ts / sketch.ts / datum.ts / index.ts
│       ├── stores/             # caveStore / segmentStore / stationStore / sketchStore / datumStore（Zustand）
│       ├── components/common/  # SegmentTag / BearingInput / ClosureBadge / GridCanvas
│       ├── hooks/              # usePersistentStore / useClosureCheck
│       ├── pages/datum/     # BenchmarkPanel / EntrancePanel / ElevationPanel / UnconfirmedPanel
│       ├── pages/              # CavesPage / SegmentsPage / StationsPage / DatumPage / SketchPage / MergePage
│       ├── router/index.ts
│       └── utils/              # survey.ts / datum.ts / export.ts / id.ts
```

## 五、数据模型与存储

| 模型 | 说明 | Dexie 表 |
| --- | --- | --- |
| Cave 洞穴 | 归属根节点：洞名、行政区、经纬度、海拔、发育层位、已知总长、负责人等 | `caves` |
| Segment 洞段 | 起止桩号、类型（竖井/廊道/厅堂/裂隙/水道）、平均宽高、是否闭合 | `segments` |
| Station 测点 | 方位角、倾角、斜距 → 自动推算水平距/垂距，累计闭合差 | `stations` |
| Sketch 草图 | 格数、比例、绘制人、拼合顺序号、桩号对齐锚点 | `sketches` |
| Benchmark 水准点 | 普查登记室保管：点名、等级、高程、认定结论（已认定/待核/已注销） | `benchmarks` |
| Entrance 洞口资料 | 登记室保管：洞口点名（两摊对账唯一键）、经纬度、海拔、接测水准点、接测高差、基准版本号 | `entrances` |
| SegmentElevation 洞段成果 | 测量小组保管：洞口点名、累计垂距、终点高程、认定基准快照、状态机 | `elevations` |

- 数据库名 `gbcavesurvey`，`meta` 表保存 `schemaVersion`；
- `version(2)` 升级迁移会把旧版测点记录由「斜距 + 倾角」补齐 `horizontalDistance` / `verticalDistance`；
- `version(3)` 升级迁移把「洞口资料 / 洞内成果」拆成两摊：每个洞穴生成一份洞口资料，每个洞段生成一条高程成果；旧洞段没有接测基准，**按当时的洞口海拔回填**，回填不上（洞口资料缺失或无测点读数）的单列进「回填待确认」队列等人工指认；
- 数据仅存于浏览器本地，容器无状态、不挂载命名卷，清除浏览器数据即清空。

### 高程基准两摊分管与对账

- **登记室一摊**（`benchmarks` + `entrances`）：管洞口经纬度、海拔、接测的水准点与接测高差；洞口海拔或接测点一经改动，洞口的 `datumVersion` 自增，**只把旧版本上「已认基准」的洞段成果挑为待重算**（旧基准快照保留可回溯，现场测点读数原样不动）；
- **测量组一摊**（`elevations`）：管各洞段的洞口点名、测点累计垂距与洞段成果；
- **对账**：两摊按洞口点名对账——洞口查无、未接测 / 水准点结论未定（待核、注销）、接测高差与累计垂距相差超过容差（默认 0.1 m）的洞段先挂「待核」，基准归属由登记室的水准点结论决定；
- **只重试这一个洞段**：单段对账失败只重挂该段，已经按新基准认过的洞段不跟着回退；「批量对账」也只处理待提交 / 待核 / 待重算，已认基准与回填待确认的跳过；
- 终点高程 = 洞口海拔 + 累计垂距（垂距下降为负），认定时留存基准快照（洞口海拔、水准点、接测高差、基准版本、认定时间）。

## 六、主要页面

| 路由 | 功能 |
| --- | --- |
| `/caves` | 洞穴清单：卡片展示实测/已知总长、洞段数、最近测量日期，支持新建、编辑、归档、删除（删除前校验下级洞段数） |
| `/segments` | 洞段编目表：按桩号区间/类型/洞穴筛选，批量调整洞段类型与闭合标记，自动累计总长 |
| `/stations` | 测点读数录入：方位角/倾角专用输入（度分秒 ⇄ 十进制度），自动推算水平距垂距，实时闭合差徽标，异常读数整行高亮，支持连续录入下一站 |
| `/datum` | 高程基准对账台：登记室维护洞口资料/水准点结论，测量组登记洞段成果；按洞口点名对账，基准变更自动挑出待重算，旧数据升级回填单列待确认 |
| `/sketch` | 草图工作台：坐标纸网格上绘制测点折线、标注桩号与倾角箭头，支持草图基准方位旋转与草图记录管理 |
| `/merge` | 图幅拼合视图：拖动图幅按相邻边缘吸附、按桩号锚点一键对齐，输出可调整的拼合顺序表并支持 CSV 导出 |

## 七、计算约定

- 水平距 = 斜距 × cos(倾角)，垂距 = 斜距 × sin(倾角)；
- 闭合差 f = √(ΣΔE² + ΣΔN²)，默认阈值 0.25 m，超限时徽标变红并可展开计算过程；
- 方位角范围 0°–360°，倾角范围 -90°–90°，越界读数会被标记为异常。
