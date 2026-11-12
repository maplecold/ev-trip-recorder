# EV Trip Recorder

> English: [README.en.md](README.en.md) · 状态机图：[docs/state-machine.svg](docs/state-machine.svg)

**一个与车厂无关的「新能源车行程记录算法」**：吃标准化遥测帧，吐行程记录（起终点、里程、耗时、能耗、轨迹）。

服务端采集、手机端只读的场景下用它最合适——车停着的时候手机可能没开，本地录制必然漏记。

```
遥测帧 ──► 运动判定 ──► 行程状态机 ──► 里程融合 ──► 能耗估算 ──► 行程记录
 10s         P/D 挡         5 分钟驻车      里程表/GPS     积分+累计差
```

零依赖，纯 JavaScript（ESM），Node ≥ 18。

## 为什么值得用

| 常见做法 | 问题 |
| :--- | :--- |
| 一停车就结束行程 | 等红灯、路边下人会把一趟路切成七八段 |
| 只用里程表算里程 | 整数公里，短途直接归零（0.7 km 读成 0 或 1） |
| 只用云端累计电量算能耗 | 整数 kWh，2 km 的短途能算出 6 度电（物理不可能） |
| 只用 GPS 算里程 | 隧道/高架漏点会偏小，静止漂移会偏大 |

这套算法对每个坑都有对应处理，见下文。

## 快速开始

```bash
npm test      # 9 个用例，覆盖起止判定/里程融合/能耗/断帧
npm run demo  # 用合成数据跑一趟完整行程
```

```js
import { TripRecorder } from 'ev-trip-recorder';

const recorder = new TripRecorder({
  onTripFinished: (trip) => saveToDatabase(trip),
});

// 每采到一帧就喂进去（行驶中 10 秒一次，驻车 30–120 秒）
recorder.observe({
  timestamp: Date.now(),
  gear: 'D',                 // P / D / R / N ...
  speed: 42,                 // km/h
  powered: true,             // 整车是否上电
  odometerKm: 21_503,        // 里程表
  batteryVoltageV: 349.6,
  batteryCurrentA: 45,
  location: { latitude: 24.9, longitude: 102.7 },
  cumulativeEnergyKwh: 2893, // 云端累计电量（可选）
});

console.log(recorder.list()); // 按时间倒序的行程
```

## 算法详解

### 1. 运动判定：挡位 → 车速 → 电源

顺序和车机主页一致，**不能只看挡位**（有些车型没有 P 挡，或挡位信号缺失）：

| 顺序 | 条件 | 结论 |
| :--- | :--- | :--- |
| 1 | 挡位 = `P` / `PARK` / `0` | 驻车 |
| 2 | 挡位 = `D` / `R` / `1` / `3` | 行驶 |
| 3 | 车速 > 0（且 < 1000，排除异常值） | 行驶 |
| 4 | 整车下电（`powered === false`） | 驻车 |
| 5 | 其余 | 驻车（保守） |

### 2. 行程开始：第一帧「行驶」

一旦判定为行驶且当前无进行中的行程，立即开始；起点取「上一帧驻车」的位置（更接近真实出发位置）。

### 3. 行程结束：连续驻车满 5 分钟

```
第 1 帧驻车       → 记为「待确认驻车」时间点
后续仍驻车        → 检查是否满 stableParkingMs（默认 5 分钟）
  ├ 满 5 分钟     → 结束行程，endedAt = 待确认那一刻
  └ 期间出现行驶   → 清空「待确认」，同一趟继续
```

**结束时间取"刚开始驻车那一刻"**，所以等的那 5 分钟不会算进时长。

为什么是 5 分钟：红灯通常 < 2 分钟，路边上下人 < 3 分钟，5 分钟能覆盖绝大多数误判。

### 4. 里程融合：长途信里程表，短途信 GPS

| 来源 | 精度 | 盲区 |
| :--- | :--- | :--- |
| 里程表 | ±0.5 km（整数） | 短途归零 |
| GPS 轨迹 | ±30 m | 隧道漏点、静止漂移 |

```
里程表差值 ≥ 3 km                      → 用里程表
里程表 < 3 km 且 GPS 与它相差 ≤ 1 km    → 用 GPS（保留小数）
里程表能解析（≥ 0.5 km）                → 用里程表
否则 GPS ≥ 0.3 km                       → 用 GPS
```

输出里带 `distanceSource`（`ODOMETER` / `GPS`），便于排查。

### 5. 能耗：积分打底，累计差标定

两条独立来源：

- **V×I 积分**：`功率 = 电压 × 电流`，梯形法逐帧累加。有小数精度，但有系统偏差；
- **云端累计电量**：整数 kWh，长期无偏，短途误差巨大（±0.5 kWh 对 0.7 km 就是 ±150%）。

策略：

```
短途（< 2 km）：积分值 × 学到的修正系数
长途（≥ 2 km）：累计差值（做合理性闸门）
两者都可用时  ：k = 累计差 / 积分，取最近 20 个样本的中位数，作为后续积分的修正系数
```

合理性闸门（`isPlausibleCumulative`）：按百公里电耗判断，`1 ~ 80 kWh/100km` 之外一律不采信。
短途开空调 40+ 很正常，所以上限放到 80，只拦「2 公里 6 度电」这种数量级错误。

### 6. 断帧与完整性

相邻两帧间隔 > `frameGapMs`（默认 10 分钟）标记 `PARTIAL`。
断帧时里程优先用里程表——GPS 会漏掉未观测的那一段。

### 7. 轨迹

按最小间距（默认 8 m）丢点，首尾必留。轨迹点结构：

```js
{ latitude, longitude, timestamp, speedKmh }
```

## API

### `new TripRecorder(options)`

| 选项 | 默认 | 说明 |
| :--- | :--- | :--- |
| `stableParkingMs` | `5 * 60_000` | 连续驻车多久算结束 |
| `frameGapMs` | `10 * 60_000` | 断帧阈值 |
| `routeMinSpacingMeters` | `8` | 轨迹最小点距 |
| `retainDays` | `30` | 行程保留天数 |
| `minElectricalCoverageRatio` | `0.5` | 积分覆盖率低于此值不采信 |
| `store` | 内存 | 持久化容器 `{ trips, runtime, save() }` |
| `onTripFinished` | `null` | 行程结束回调 |

### 方法

| 方法 | 说明 |
| :--- | :--- |
| `observe(frame)` | 喂一帧，返回 `{ started?, finished? }` |
| `list()` | 行程列表（按开始时间倒序） |
| `cleanup(now)` | 删除超过保留期的行程 |

### 导出的工具函数

`classifyMotion` / `haversineMeters` / `pathLengthMeters` / `fuseDistance` / `simplifyByDistance` / `integrateEnergy` / `powerW` / `clampCalibration` / `medianCalibration` / `isPlausibleCumulative`

## 数据结构

```json
{
  "tripId": "trip_m3k2_ab12cd",
  "startedAt": 1800000000000,
  "endedAt": 1800002400000,
  "durationMinutes": 40,
  "distanceKm": 12,
  "distanceSource": "ODOMETER",
  "gpsDistanceMeters": 11870,
  "energyKwh": 2.4,
  "energySource": "INTEGRATED",
  "completeness": "COMPLETE",
  "maxFrameGapMs": 0,
  "route": [{ "latitude": 24.9, "longitude": 102.7, "timestamp": 1800000000000, "speedKmh": 34 }]
}
```

## 接入你自己的车

只要能把车的数据标准化成上面那个 `frame`，就能直接用。典型接入方式：

1. 轮询车厂云端接口（注意：多数车厂的 token 有效期很短，需要定期续期）；
2. 车机/车联网盒子 MQTT 推送；
3. OBD 蓝牙适配器。

采样频率（实测配置，分场景）：行驶中 **10 秒**一帧；驻车但仍在记录时 **30 秒**；长时间驻车 **120 秒**。越稀疏，里程与能耗的积分误差越大。

## 许可

MIT
