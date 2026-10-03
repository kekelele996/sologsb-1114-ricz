import { assert } from 'node:console'
import { cumulativeVerticalOf, settleDatum, backfillDatum, levelDeltaOf, isLevelDeltaMatched, DATUM_TOLERANCE } from '../src/utils/datum'

let passed = 0
function check(name, cond) {
  if (!cond) throw new Error('FAIL: ' + name)
  passed++
  console.log('ok -', name)
}

// 测量小组累计垂距：带符号求和
const vertical = cumulativeVerticalOf([
  { verticalDistance: -0.541, dip: -2.5, slopeDistance: 12.4 },
  { verticalDistance: -0.496, dip: -1.8, slopeDistance: 15.8 }
])
check('cumulative vertical sums signed drops', vertical === -1.037)
check('empty stations -> null', cumulativeVerticalOf([]) === null)

// 登记室接测高差
const cave = { entranceCode: 'RK-01', altitude: 986.4, datumBenchmark: 'BM-1', benchmarkAltitude: 987.5 }
check('level delta', levelDeltaOf(cave) === -1.1)
check('no benchmark -> null', levelDeltaOf({ altitude: 986.4, benchmarkAltitude: null }) === null)
check('match within tolerance', isLevelDeltaMatched(-1.1, -1.05, DATUM_TOLERANCE) === true)
check('mismatch beyond tolerance', isLevelDeltaMatched(-1.1, -2.0, DATUM_TOLERANCE) === false)
check('null never matches', isLevelDeltaMatched(null, -1.1) === false)

// 场景1：两边对得上 -> 已认基准，成果高程 = 基准 + 接测高差 + 累计垂距
const seg = {
  entranceCode: 'RK-01',
  datumLevelDelta: -9.9, // 旧账上的过期值，必须被登记室现值覆盖
  cumulativeVertical: -9.9,
  datumBenchmark: 'OLD-BM',
  datumEntranceAltitude: 900,
  resultAltitude: null
}
const ok = settleDatum({ segment: seg, cave, recomputedVertical: -1.1 })
check('matched -> confirmed', ok.status === 'confirmed')
check('registry delta overrides segment copy', ok.datumLevelDelta === -1.1)
check('confirmed benchmark = registry benchmark', ok.datumBenchmark === 'BM-1')
check('confirmed result altitude', ok.resultAltitude === 987.5 - 1.1 - 1.1)
check('confirmed stamped at', ok.datumConfirmedAt !== null)

// 场景2：高差对不上 -> 待核，成果不出
const mismatch = settleDatum({ segment: seg, cave, recomputedVertical: -2.0 })
check('delta mismatch -> pending', mismatch.status === 'pending')
check('pending mismatch recorded', mismatch.mismatch === round3(-1.1 - -2.0))
check('pending clears result altitude', mismatch.resultAltitude === null)
check('pending records registry benchmark for attribution', mismatch.datumBenchmark === 'BM-1')

// 场景3：洞口点名对不上 -> 待核
const noCave = settleDatum({
  segment: { ...seg, entranceCode: 'RK-99' },
  cave: null,
  recomputedVertical: -1.1
})
check('unknown entrance -> pending', noCave.status === 'pending')
check('unknown entrance keeps old benchmark', noCave.datumBenchmark === 'OLD-BM')

// 场景4：登记室水准点结论未给 -> 待核
const noBm = settleDatum({
  segment: seg,
  cave: { ...cave, benchmarkAltitude: null },
  recomputedVertical: -1.1
})
check('missing benchmark conclusion -> pending', noBm.status === 'pending')

// 场景5：测量小组还没有读数 -> 待核
const noReading = settleDatum({ segment: seg, cave, recomputedVertical: null })
check('no readings -> pending', noReading.status === 'pending')

// 场景6：人工确认海拔回填（台账暂时无同点名洞口）
const manual = settleDatum({
  segment: { ...seg, entranceCode: '' },
  cave: null,
  recomputedVertical: null,
  manualAltitude: 986.4
})
check('manual altitude with no readings still pending', manual.status === 'pending')
check('manual altitude stored', manual.datumEntranceAltitude === 986.4)

// 旧数据升级回填
const filled = backfillDatum({ entranceCode: 'RK-01', caveId: 'c1' }, { id: 'c1', altitude: 986.4 }, -3.2)
check('legacy with cave altitude -> confirmed(backfilled)', filled.datumStatus === 'confirmed')
check('backfilled altitude kept', filled.datumEntranceAltitude === 986.4)
check('backfilled result altitude', filled.resultAltitude === 983.2)
const missing = backfillDatum({ entranceCode: '', caveId: 'c2' }, null, -3.2)
check('legacy without cave -> unbackfilled', missing.datumStatus === 'unbackfilled')
check('unbackfilled note', String(missing.datumNote).includes('回填不上'))

function round3(v) { return Math.round(v * 1000) / 1000 }
console.log(`\n${passed} checks passed`)
