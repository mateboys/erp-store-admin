<template>
  <div class="page">
    <div class="page-card">
      <div class="flex-between">
        <div>
          <h3 class="page-title">经营总览 · {{ auth.storeName }}</h3>
          <div class="page-sub">
            {{ todayStr }} ·
            {{ auth.canSeeCost ? '含成本与毛利' : '当前角色不展示成本与毛利' }}
          </div>
        </div>
        <el-button :icon="Refresh" @click="loadAll">刷新</el-button>
      </div>
    </div>

    <div class="stat-grid" :class="{ six: auth.canSeeCost }" style="margin-bottom: 16px">
      <div class="stat-card grad-1">
        <div class="label"><el-icon><Wallet /></el-icon>今日营业额</div>
        <div class="value">¥ {{ money(ov.today?.sales) }}</div>
        <div v-if="ov.today?.returnAmount > 0" class="ret-line">
          退货 -¥{{ money(ov.today.returnAmount) }} · {{ ov.today.returnItems }} 件
        </div>
        <div class="foot">
          <span>昨日 ¥{{ money(ov.yesterday?.sales) }}</span>
          <span :class="trendClass(ov.dod?.sales)">
            {{ trendText(ov.dod?.sales) }}
          </span>
        </div>
      </div>

      <div v-if="auth.canSeeCost" class="stat-card grad-2">
        <div class="label"><el-icon><TrendCharts /></el-icon>今日毛利</div>
        <div class="value">¥ {{ money(ov.today?.profit) }}</div>
        <div class="foot">
          <span>毛利率 {{ profitRate(ov.today) }}</span>
          <span :class="trendClass(ov.dod?.profit)">{{ trendText(ov.dod?.profit) }}</span>
        </div>
      </div>
      <div class="stat-card grad-3">
        <div class="label"><el-icon><Tickets /></el-icon>今日订单</div>
        <div class="value">{{ ov.today?.orders || 0 }} 单</div>
        <div class="foot">
          <span>售出 {{ ov.today?.items || 0 }} 件</span>
          <span v-if="ov.today?.returnItems > 0">退 {{ ov.today.returnItems }} 件</span>
        </div>
      </div>

      <div class="stat-card grad-4">
        <div class="label"><el-icon><DataLine /></el-icon>本月营业额</div>
        <div class="value">¥ {{ money(ov.month?.sales) }}</div>
        <div v-if="ov.month?.returnAmount > 0" class="ret-line">
          退货 -¥{{ money(ov.month.returnAmount) }} · {{ ov.month.returnItems }} 件
        </div>
        <div class="foot">
          <span>上月同期 ¥{{ money(ov.lastMonth?.sales) }}</span>
          <span :class="trendClass(ov.mom?.sales)">{{ trendText(ov.mom?.sales) }}</span>
        </div>
      </div>

      <div v-if="auth.canSeeCost" class="stat-card grad-5">
        <div class="label"><el-icon><Coin /></el-icon>本月毛利</div>
        <div class="value">¥ {{ money(ov.month?.profit) }}</div>
        <div class="foot">
          <span>上月同期 ¥{{ money(ov.lastMonth?.profit) }}</span>
          <span :class="trendClass(ov.mom?.profit)">{{ trendText(ov.mom?.profit) }}</span>
        </div>
      </div>
      <div class="stat-card grad-6">
        <div class="label"><el-icon><Goods /></el-icon>本月售出</div>
        <div class="value">{{ ov.month?.items || 0 }} 件</div>
        <div class="foot">
          <span>共 {{ ov.month?.orders || 0 }} 单</span>
          <span v-if="ov.month?.returnItems > 0">退货 {{ ov.month.returnItems }} 件</span>
        </div>
      </div>
    </div>

    <!-- 趋势图 -->
    <div class="page-card">
      <div class="flex-between" style="margin-bottom: 14px; flex-wrap: wrap">
        <div class="flex" style="flex-wrap: wrap">
          <el-radio-group v-model="range" size="default" @change="onRangeChange">
            <el-radio-button value="day14">近 14 天</el-radio-button>
            <el-radio-button value="month">按月份</el-radio-button>
            <el-radio-button value="month12">近 12 个月</el-radio-button>
            <el-radio-button value="custom">自定义</el-radio-button>
          </el-radio-group>

          <el-date-picker
            v-if="range === 'month'"
            v-model="pickMonth"
            type="month"
            value-format="YYYY-MM"
            placeholder="选择月份"
            style="width: 160px"
            :clearable="false"
            :disabled-date="noFutureMonth"
            @change="loadTrend"
          />
          <span v-if="range === 'month'" class="muted" style="font-size: 12px">
            默认当前月，按整月 1 号至月末统计
          </span>
          <el-date-picker
            v-if="range === 'custom'"
            v-model="customRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            style="width: 250px"
            @change="loadTrend"
          />
        </div>

        <el-radio-group v-model="metric" @change="loadTrend">
          <el-radio-button value="sales">营业额趋势</el-radio-button>
          <el-radio-button value="profit" :disabled="!auth.canSeeCost">毛利趋势</el-radio-button>
          <el-radio-button value="both" :disabled="!auth.canSeeCost">双轴对比</el-radio-button>
        </el-radio-group>
      </div>

      <EChart :option="trendOption" height="360px" />
    </div>

    <!-- 库存告警 + 退货趋势：与下方「业绩对比 + 热销」同样的 10 / 14 分栏、同样的内容高度，
         左右颠倒摆放形成错位（下面左图右表，这里左表右图） -->
    <el-row :gutter="16" class="equal-row">
      <!-- 库存告警：剩余 <= 5 件（含缺货），按剩余量升序 -->
      <el-col :span="isWide ? 10 : 24">
        <div class="page-card">
          <div class="flex-between card-head">
            <div class="flex" style="gap: 8px; align-items: baseline">
              <b>库存告警</b>
              <span class="muted" style="font-size: 12px">
                剩余 ≤ {{ lowStock.threshold || 5 }} 件
              </span>
            </div>
            <div class="flex" style="gap: 8px; align-items: center">
              <el-tag v-if="lowStock.total" type="warning" effect="light" size="small">
                {{ lowStock.total }} 项待补货
              </el-tag>
              <el-button link type="primary" @click="goStock">去库存管理</el-button>
            </div>
          </div>
          <el-table
            :data="lowStock.rows || []"
            size="small"
            height="320"
            v-loading="lowLoading"
          >
            <!-- 公司总览下要让位给「门店」列，就不再显示图片 -->
            <el-table-column v-if="!isAll" label="图片" width="50">
              <template #default="{ row }">
                <el-image :src="img(row.image)" fit="cover" class="product-thumb" />
              </template>
            </el-table-column>
            <el-table-column prop="sku" label="货号" width="92" />
            <el-table-column prop="name" label="品名" min-width="120" show-overflow-tooltip />
            <el-table-column
              v-if="isAll"
              prop="storeName"
              label="门店"
              min-width="100"
              show-overflow-tooltip
            />
            <el-table-column label="剩余库存" width="86" align="right">
              <template #default="{ row }">
                <el-tag
                  :type="row.quantity <= 0 ? 'danger' : 'warning'"
                  effect="light"
                  size="small"
                >
                  {{ row.quantity <= 0 ? '缺货' : row.quantity + ' 件' }}
                </el-tag>
              </template>
            </el-table-column>
            <template #empty>
              <el-empty description="库存都很充足，暂无需要补货的商品" :image-size="70" />
            </template>
          </el-table>
        </div>
      </el-col>

      <!-- 退货趋势：金额（柱，左轴）+ 件数（线，右轴），跟随上面的时间范围 -->
      <el-col :span="isWide ? 14 : 24">
        <div class="page-card">
          <div class="flex-between card-head">
            <b>退货趋势</b>
            <span class="muted" style="font-size: 12px">
              退款 ¥{{ money(trend.totalReturns) }} · {{ returnItemsTotal }} 件
            </span>
          </div>
          <EChart :option="returnTrendOption" height="320px" />
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="equal-row">
      <el-col :span="isWide ? 14 : 24">
        <div class="page-card">
          <div class="flex-between card-head">
            <b>{{ multiStore ? '门店业绩对比' : '门店业绩' }}</b>
            <el-radio-group v-model="storeRange" size="small" @change="loadByStore">
              <el-radio-button value="day">今日</el-radio-button>
              <el-radio-button value="month">本月</el-radio-button>
            </el-radio-group>
          </div>
          <EChart :option="storeOption" height="320px" />
        </div>
      </el-col>
      <el-col :span="isWide ? 10 : 24">
        <div class="page-card">
          <div class="flex-between card-head"><b>本月热销商品 TOP</b></div>
          <el-table :data="ov.topProducts || []" size="small" height="320">
            <el-table-column type="index" width="46" />
            <el-table-column prop="name" label="品名" min-width="120" show-overflow-tooltip />
            <el-table-column prop="quantity" label="销量" width="70" align="right" />
            <el-table-column label="销售额" width="100" align="right">
              <template #default="{ row }">¥{{ money(row.amount) }}</template>
            </el-table-column>
            <el-table-column v-if="auth.canSeeCost" label="毛利" width="90" align="right">
              <template #default="{ row }">¥{{ money(row.profit) }}</template>
            </el-table-column>
            <template #empty>
              <el-empty description="本月暂无销售数据" :image-size="70" />
            </template>
          </el-table>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { useRouter } from 'vue-router'
import { Refresh } from '@element-plus/icons-vue'
import EChart from '@/components/EChart.vue'
import { dashboardApi } from '@/api'
import { useUserStore } from '@/stores/user'

const auth = useUserStore()
const router = useRouter()
const todayStr = dayjs().format('YYYY年MM月DD日')

const ov = ref({})
const range = ref('day14')
const metric = ref('sales')
const pickMonth = ref(dayjs().format('YYYY-MM'))
const customRange = ref([dayjs().subtract(29, 'day').format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD')])
const trend = ref({ labels: [], sales: [], profit: [], orders: [], items: [], returns: [], returnItems: [] })
const byStore = ref([])
const storeRange = ref('month')

const isWide = computed(() => window.innerWidth > 1200)
/** 管理员在「公司总览」时是跨店视角，告警表要显示门店列 */
const isAll = computed(() => auth.isAdmin && auth.storeId === 'all')
/**
 * 是否具备多店视角：能看多家店时图表才是「门店业绩对比」，
 * 单店（店长/店员，或公司实际只有一家店）只叫「门店业绩」。
 * 门店列表是异步拉的，这里再兜一层接口返回的门店条数，避免刷新时先闪一下错标题。
 */
const multiStore = computed(
  () => auth.isAdmin && ((auth.stores?.length || 0) > 1 || byStore.value.length > 1)
)

/* ---------- 库存告警 ---------- */
const lowStock = ref({ threshold: 5, total: 0, rows: [] })
const lowLoading = ref(false)

function goStock() {
  // 库存列表现在是「库存管理」页的第 1 个 tab
  router.push({ path: '/inventory', query: { tab: 'stock' } })
}

function img(u) {
  return (
    u ||
    'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" fill="#f0f0f7"/><text x="22" y="27" font-size="14" fill="#b6b6cc" text-anchor="middle">衣</text></svg>`
      )
  )
}

async function loadLowStock() {
  if (!auth.token) return
  lowLoading.value = true
  try {
    lowStock.value = await dashboardApi.lowStock(auth.storeId, 30)
  } finally {
    lowLoading.value = false
  }
}

/** 月份选择器不允许选未来月份（选了也全是 0，只会让人困惑） */
const noFutureMonth = (d) => d.getTime() > dayjs().endOf('month').valueOf()

const money = (v) => (v == null ? '0.00' : Number(v).toFixed(2))

function trendClass(v) {
  if (v == null) return ''
  return v >= 0 ? 'trend-up' : 'trend-down'
}
function trendText(v) {
  if (v == null || v === 0) return '持平'
  return `${v > 0 ? '↑' : '↓'} ${Math.abs(v)}%`
}
function profitRate(o) {
  if (!o || !o.sales) return '-'
  return `${((o.profit / o.sales) * 100).toFixed(1)}%`
}

async function loadOverview() {
  ov.value = await dashboardApi.overview(auth.storeId)
}

async function loadTrend() {
  const params = { storeId: auth.storeId, range: range.value }
  if (range.value === 'month') params.month = pickMonth.value || dayjs().format('YYYY-MM')
  if (range.value === 'custom' && customRange.value?.length === 2) {
    params.from = customRange.value[0]
    params.to = customRange.value[1]
  }
  trend.value = await dashboardApi.trend(params)
}

async function loadByStore() {
  byStore.value = await dashboardApi.byStore(storeRange.value)
}

function onRangeChange() {
  if (range.value !== 'custom' || customRange.value?.length === 2) loadTrend()
}

function loadAll() {
  // 登出后 storeId 会变化触发 watch，此时不应再请求
  if (!auth.token) return
  loadOverview()
  loadTrend()
  loadByStore()
  loadLowStock()
}

const trendOption = computed(() => {
  const t = trend.value
  const isMoney = metric.value !== 'orders'
  const series = []
  const hasReturns = metric.value !== 'orders' && (t.returns || []).some((v) => v > 0)
  if (metric.value === 'sales' || metric.value === 'both') {
    series.push({
      name: '营业额',
      type: metric.value === 'both' ? 'bar' : 'line',
      smooth: true,
      symbolSize: 7,
      data: t.sales || [],
      itemStyle: { color: '#6c5ce7' },
      areaStyle:
        metric.value === 'sales'
          ? {
              color: {
                type: 'linear',
                x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: 'rgba(108,92,231,0.35)' },
                  { offset: 1, color: 'rgba(108,92,231,0.02)' }
                ]
              }
            }
          : undefined
    })
  }
  if (metric.value === 'profit' || metric.value === 'both') {
    series.push({
      name: '毛利',
      type: metric.value === 'both' ? 'bar' : 'line',
      smooth: true,
      symbolSize: 7,
      data: t.profit || [],
      itemStyle: { color: '#00b894' },
      areaStyle:
        metric.value === 'profit'
          ? {
              color: {
                type: 'linear',
                x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: 'rgba(0,184,148,0.32)' },
                  { offset: 1, color: 'rgba(0,184,148,0.02)' }
                ]
              }
            }
          : undefined
    })
  }
  if (metric.value === 'orders') {
    series.push({
      name: '订单数',
      type: 'bar',
      data: t.orders || [],
      itemStyle: { color: '#0984e3', borderRadius: [4, 4, 0, 0] }
    })
  }

  // 退货单独一条柱：按退货发生日统计，销售额里已经扣过，不重复计入
  if (hasReturns) {
    series.push({
      name: '退货额',
      type: 'bar',
      data: t.returns || [],
      barMaxWidth: 16,
      itemStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: '#9b8cff' },
            { offset: 1, color: '#7c6cf0' }
          ]
        },
        borderRadius: [3, 3, 0, 0]
      }
    })
  }

  return {
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v) =>
        v == null ? '-' : isMoney ? '¥' + Number(v).toFixed(2) : String(Number(v))
    },
    legend: { data: series.map((s) => s.name), right: 10 },
    grid: { left: 60, right: 24, top: 40, bottom: 40 },
    xAxis: {
      type: 'category',
      data: t.labels || [],
      boundaryGap: metric.value === 'orders' || hasReturns,
      axisLine: { lineStyle: { color: '#dcdce8' } },
      axisLabel: { color: '#8a8aa0' }
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#8a8aa0', formatter: isMoney ? '¥{value}' : '{value}' },
      splitLine: { lineStyle: { color: '#f0f0f7' } }
    },
    dataZoom: (t.labels?.length || 0) > 20 ? [{ type: 'slider', height: 18, bottom: 6 }] : [],
    series
  }
})

/** 退货趋势合计件数 */
const returnItemsTotal = computed(() =>
  (trend.value.returnItems || []).reduce((s, v) => s + v, 0)
)

/** 退货趋势：金额（柱，左轴 ¥）+ 件数（折线，右轴 件） */
const returnTrendOption = computed(() => {
  const t = trend.value
  return {
    tooltip: {
      trigger: 'axis',
      formatter: (ps) => {
        const label = ps[0]?.axisValueLabel || ps[0]?.axisValue || ''
        const amt = ps.find((p) => p.seriesName === '退货额')?.value ?? 0
        const cnt = ps.find((p) => p.seriesName === '退货件数')?.value ?? 0
        return `${label}<br/>退货额：¥${Number(amt).toFixed(2)}<br/>退货件数：${cnt} 件`
      }
    },
    legend: { data: ['退货额', '退货件数'], top: 2, left: 'center' },
    grid: { left: 62, right: 54, top: 46, bottom: 40 },
    xAxis: {
      type: 'category',
      data: t.labels || [],
      boundaryGap: true,
      axisLine: { lineStyle: { color: '#dcdce8' } },
      axisLabel: { color: '#8a8aa0' }
    },
    yAxis: [
      {
        type: 'value',
        name: '金额',
        nameTextStyle: { color: '#8a8aa0', fontSize: 11 },
        axisLabel: { color: '#8a8aa0', formatter: '¥{value}' },
        splitLine: { lineStyle: { color: '#f0f0f7' } }
      },
      {
        type: 'value',
        name: '件数',
        nameTextStyle: { color: '#8a8aa0', fontSize: 11 },
        axisLabel: { color: '#8a8aa0' },
        splitLine: { show: false }
      }
    ],
    dataZoom: (t.labels?.length || 0) > 20 ? [{ type: 'slider', height: 18, bottom: 6 }] : [],
    series: [
      {
        name: '退货额',
        type: 'bar',
        data: t.returns || [],
        barMaxWidth: 22,
        itemStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: '#9b8cff' },
              { offset: 1, color: '#7c6cf0' }
            ]
          },
          borderRadius: [4, 4, 0, 0]
        }
      },
      {
        name: '退货件数',
        type: 'line',
        smooth: true,
        symbolSize: 7,
        yAxisIndex: 1,
        data: t.returnItems || [],
        itemStyle: { color: '#3aa0ff' },
        lineStyle: { width: 2, color: '#3aa0ff' }
      }
    ]
  }
})

const storeOption = computed(() => ({
  tooltip: { trigger: 'axis', valuePrefix: '¥' },
  grid: { left: 60, right: 20, top: 30, bottom: 30 },
  xAxis: {
    type: 'category',
    data: byStore.value.map((s) => s.storeName),
    axisLabel: { color: '#8a8aa0', interval: 0, rotate: byStore.value.length > 4 ? 20 : 0 }
  },
  yAxis: {
    type: 'value',
    axisLabel: { color: '#8a8aa0', formatter: '¥{value}' },
    splitLine: { lineStyle: { color: '#f0f0f7' } }
  },
  series: [
    {
      name: '营业额',
      type: 'bar',
      barWidth: '38%',
      data: byStore.value.map((s) => s.sales),
      itemStyle: {
        borderRadius: [6, 6, 0, 0],
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: '#6c5ce7' },
            { offset: 1, color: '#a29bfe' }
          ]
        }
      }
    },
    ...(auth.canSeeCost
      ? [
          {
            name: '毛利',
            type: 'bar',
            barWidth: '38%',
            data: byStore.value.map((s) => s.profit),
            itemStyle: {
              borderRadius: [6, 6, 0, 0],
              color: {
                type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: '#00b894' },
                  { offset: 1, color: '#26d0a6' }
                ]
              }
            }
          }
        ]
      : [])
  ],
  legend: { data: auth.canSeeCost ? ['营业额', '毛利'] : ['营业额'], right: 10 }
}))

watch(
  () => auth.storeId,
  () => loadAll()
)

onMounted(loadAll)
</script>
