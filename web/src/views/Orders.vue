<template>
  <div class="page fill">
    <div class="page-card">
      <div class="flex-between" style="flex-wrap: wrap">
        <div>
          <h3 class="page-title">销售记录</h3>
          <div class="page-sub">
            {{ auth.storeName }} · {{ mineOnly ? '我的销售' : '全部销售' }} · 共 {{ total }} 单，营业额合计
            ¥{{ totalAmount.toFixed(2) }}
            <template v-if="auth.canSeeCost">，毛利 ¥{{ totalProfit.toFixed(2) }}</template>
          </div>
        </div>
        <div class="flex" style="flex-wrap: wrap">
          <el-radio-group v-model="mineOnly" @change="search">
            <el-radio-button :value="false">全部</el-radio-button>
            <el-radio-button :value="true">我的</el-radio-button>
          </el-radio-group>
          <el-date-picker
            v-model="range"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            style="width: 250px"
            @change="search"
          />
          <el-input
            v-model="keyword"
            placeholder="订单号"
            clearable
            style="width: 170px"
            :prefix-icon="Search"
            @keyup.enter="searchByOrderNo"
            @clear="searchByOrderNo"
          />
          <el-button :icon="Refresh" @click="load">刷新</el-button>
        </div>
      </div>

      <div class="table-fill">
        <el-table :data="list" v-loading="loading" height="100%">
        <!-- 用 min-width 而非 width：剩余宽度按比例分摊给这几列，避免右侧留白 -->
        <el-table-column prop="orderNo" label="订单号" min-width="200" />
        <el-table-column v-if="isAll" prop="storeName" label="门店" min-width="150" />
        <el-table-column label="件数" width="80" align="right">
          <template #default="{ row }">{{ row.itemCount }}</template>
        </el-table-column>
        <el-table-column label="营业额" width="120" align="right">
          <template #default="{ row }">
            <b :class="row.totalAmount < 0 ? 'trend-down' : 'money'">{{ money(row.totalAmount) }}</b>
          </template>
        </el-table-column>
        <el-table-column label="退货" width="145" align="right">
          <template #default="{ row }">
            <el-tooltip
              v-if="row.type === 'RETURN'"
              content="没关联原订单的退货，单独开一张负数冲减单，抵减退货当天的营业额与毛利"
              placement="top"
            >
              <el-tag type="danger" effect="light" size="small">未关联退货</el-tag>
            </el-tooltip>
            <el-tooltip
              v-else-if="row.returnAmount > 0"
              :content="`已退 ${row.returnCount} 件 / 共 ${row.itemCount + row.returnCount} 件，营业额、成本、毛利都已按退货同步冲减`"
              placement="top"
            >
              <div class="ret-cell">
                <span class="trend-down">已退 ¥{{ row.returnAmount.toFixed(2) }}</span>
                <span class="ret-sub">
                  {{
                    row.itemCount === 0
                      ? `已全部退完（${row.returnCount} 件）`
                      : `退了 ${row.returnCount}/${row.itemCount + row.returnCount} 件`
                  }}
                </span>
              </div>
            </el-tooltip>
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="价格调整" width="120" align="right">
          <template #default="{ row }">
            <span v-if="row.adjustFlag === 'DISCOUNT'" class="diff-down">
              -¥{{ Math.abs(row.priceDiff).toFixed(2) }}
            </span>
            <span v-else-if="row.adjustFlag === 'MARKUP'" class="diff-up">
              +¥{{ row.priceDiff.toFixed(2) }}
            </span>
            <span v-else-if="row.adjustFlag === 'MIXED'" class="mixed">
              <span class="dash">-</span>
              <el-tooltip :content="MIXED_TIP" placement="top">
                <el-icon class="q-mark"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column v-if="auth.canSeeCost" label="成本" width="110" align="right">
          <template #default="{ row }">{{ money(row.totalCost) }}</template>
        </el-table-column>
        <el-table-column v-if="auth.canSeeCost" label="毛利" width="110" align="right">
          <template #default="{ row }">
            <span :class="(row.totalProfit || 0) < 0 ? 'trend-down' : 'trend-up'">
              {{ money(row.totalProfit) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="operator" label="操作人" min-width="110" />
        <el-table-column label="下单时间" width="170">
          <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="175" class-name="col-ops" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="showDetail(row)">明细</el-button>
            <el-button
              v-if="canRevokeReturn(row)"
              link
              type="danger"
              @click="revokeReturn(row)"
            >
              撤销
            </el-button>
            <el-tooltip
              v-if="canEdit(row)"
              content="修改商品单价 / 件数与备注"
              placement="top"
            >
              <el-button link type="primary" @click="openEdit(row)">修改</el-button>
            </el-tooltip>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :description="mineOnly ? '这个区间里还没有你开的单' : '暂无销售记录'" />
        </template>
        </el-table>
      </div>

      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="total"
          layout="total, sizes, prev, pager, next, jumper"
          background
          small
        />
      </div>
    </div>

    <el-dialog v-model="detailVisible" title="订单明细" width="900px">
      <el-descriptions :column="2" border size="small" style="margin-bottom: 12px">
        <el-descriptions-item label="订单号">{{ detail.orderNo }}</el-descriptions-item>
        <el-descriptions-item label="门店">{{ detail.storeName }}</el-descriptions-item>
        <el-descriptions-item label="件数">{{ detail.itemCount }} 件</el-descriptions-item>
        <el-descriptions-item label="营业额">¥{{ detail.totalAmount?.toFixed(2) }}</el-descriptions-item>
        <el-descriptions-item label="价格调整">
          <span v-if="detail.adjustFlag === 'DISCOUNT'" class="diff-down">
            优惠 ¥{{ Math.abs(detail.priceDiff).toFixed(2) }}
          </span>
          <span v-else-if="detail.adjustFlag === 'MARKUP'" class="diff-up">
            加价 ¥{{ detail.priceDiff.toFixed(2) }}
          </span>
          <span v-else-if="detail.adjustFlag === 'MIXED'" class="muted">
            净额 0（明细里有优惠也有加价）
          </span>
          <span v-else class="muted">无</span>
        </el-descriptions-item>
        <template v-if="auth.canSeeCost">
          <el-descriptions-item label="成本">¥{{ detail.totalCost?.toFixed(2) }}</el-descriptions-item>
          <el-descriptions-item label="毛利">¥{{ detail.totalProfit?.toFixed(2) }}</el-descriptions-item>
        </template>
        <el-descriptions-item label="时间">{{ fmt(detail.createdAt) }}</el-descriptions-item>
        <el-descriptions-item label="备注">{{ detail.remark || '-' }}</el-descriptions-item>
      </el-descriptions>
      <el-alert
        v-if="detail.type === 'RETURN'"
        type="warning"
        :closable="false"
        show-icon
        title="这是一张未关联原订单的退货冲减单，金额为负，用于抵减退货当天的营业额与毛利"
        style="margin-bottom: 12px"
      />
      <el-table :data="detail.items || []" size="small" max-height="320">
        <el-table-column prop="sku" label="货号" width="110" />
        <el-table-column prop="name" label="品名" min-width="140" show-overflow-tooltip />
        <el-table-column prop="quantity" label="件数" width="70" align="right" />
        <el-table-column label="退货" width="90" align="right">
          <template #default="{ row }">
            <el-tag v-if="row.returnedQty > 0" type="warning" size="small" effect="light">
              已退 {{ row.returnedQty }}
            </el-tag>
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="单价" width="90" align="right">
          <template #default="{ row }">¥{{ row.unitPrice?.toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="小计" width="100" align="right">
          <template #default="{ row }">{{ money(row.subtotal) }}</template>
        </el-table-column>
        <el-table-column label="价格调整" width="120" align="right">
          <template #default="{ row }">
            <el-tooltip
              v-if="row.diff"
              placement="top"
              :content="`档案价 ¥${row.listPrice.toFixed(2)} → 成交价 ¥${row.unitPrice.toFixed(2)}（有效 ${row.quantity - row.returnedQty} 件）`"
            >
              <span :class="row.diff < 0 ? 'diff-down' : 'diff-up'">
                {{ row.diff < 0 ? '-' : '+' }}¥{{ Math.abs(row.diff).toFixed(2) }}
              </span>
            </el-tooltip>
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column v-if="auth.canSeeCost" label="成本" width="90" align="right">
          <template #default="{ row }">¥{{ row.unitCost?.toFixed(2) }}</template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <!-- 修改销售单 -->
    <el-dialog v-model="editVisible" title="修改销售单" width="900px">
      <el-descriptions :column="3" border size="small" style="margin-bottom: 12px">
        <el-descriptions-item label="订单号">{{ editForm.orderNo }}</el-descriptions-item>
        <el-descriptions-item label="门店">{{ editForm.storeName }}</el-descriptions-item>
        <el-descriptions-item label="操作人">{{ editForm.operator }}</el-descriptions-item>
      </el-descriptions>

      <el-table :data="editForm.items" size="small" max-height="300">
        <el-table-column prop="sku" label="货号" width="110" />
        <el-table-column prop="name" label="品名" min-width="120" show-overflow-tooltip />
        <el-table-column label="已退" width="80" align="right">
          <template #default="{ row }">
            <el-tag v-if="row.returnedQty > 0" type="warning" size="small" effect="light">
              {{ row.returnedQty }} 件
            </el-tag>
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="成交件数" width="130">
          <template #default="{ row }">
            <el-input-number
              v-model="row.quantity"
              :min="row.returnedQty > 0 ? 0 : 1"
              :step="1"
              size="small"
              style="width: 100%"
            />
          </template>
        </el-table-column>
        <el-table-column label="单价" width="140">
          <template #default="{ row }">
            <el-input-number
              v-model="row.unitPrice"
              :min="0.01"
              :precision="2"
              :step="1"
              size="small"
              style="width: 100%"
            />
          </template>
        </el-table-column>
        <el-table-column label="小计" width="100" align="right">
          <template #default="{ row }">
            <b class="money">¥{{ (row.quantity * row.unitPrice).toFixed(2) }}</b>
          </template>
        </el-table-column>
        <el-table-column label="原下单" width="90" align="right">
          <template #default="{ row }">
            <span class="muted">{{ row.quantity + row.returnedQty }} 件</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="edit-sum">
        <span class="muted" style="font-size: 12px; line-height: 1.6">
          「成交件数」是没退的部分，退掉的件数照旧保留在退货记录里；
          改件数会同步增减库存（减少回库、增加扣库存），保存后营业额与毛利自动重算
        </span>
        <span>
          调整后合计
          <b class="money" style="color: var(--brand); font-size: 18px">
            ¥{{ editTotal.toFixed(2) }}
          </b>
        </span>
      </div>

      <el-input
        v-model="editForm.remark"
        placeholder="备注（选填）"
        maxlength="100"
        show-word-limit
        style="margin-top: 10px"
      />

      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存修改</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { Search, Refresh, QuestionFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { returnApi, saleApi } from '@/api'
import { useUserStore } from '@/stores/user'

/** 净额为 0 但明细里有调整时，问号图标的说明 */
const MIXED_TIP =
  '本单既有商品优惠、也有商品加价，两者相抵后净差额为 0。点右侧「明细」可看到每一件分别是怎么调整的。'

const auth = useUserStore()
const list = ref([])
const loading = ref(false)
/** 默认看最近一个月（含今天）；清空日期即查全部 */
const range = ref([
  dayjs().subtract(1, 'month').format('YYYY-MM-DD'),
  dayjs().format('YYYY-MM-DD')
])
const keyword = ref('')
/** 只看自己开的单（个人销售记录），默认看全店 */
const mineOnly = ref(false)
/* 分页 */
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const detailVisible = ref(false)
const detail = ref({})

const isAll = computed(() => auth.isAdmin && auth.storeId === 'all')
/* 合计取筛选结果的全量（后端 summary），不随翻页变化 */
const summary = ref({ totalAmount: 0, totalProfit: 0, itemCount: 0 })
const totalAmount = computed(() => summary.value.totalAmount || 0)
const totalProfit = computed(() => summary.value.totalProfit || 0)

const fmt = (d) => dayjs(d).format('YYYY-MM-DD HH:mm')
/** 金额统一格式：负数显示成 -¥x（退货冲减单就是负数） */
const money = (v) => {
  const n = Number(v || 0)
  return n < 0 ? `-¥${Math.abs(n).toFixed(2)}` : `¥${n.toFixed(2)}`
}

async function load() {
  if (!auth.token) return
  loading.value = true
  try {
    const res = await saleApi.orders({
      storeId: auth.storeId,
      from: range.value?.[0],
      to: range.value?.[1],
      keyword: keyword.value,
      mine: mineOnly.value ? 1 : undefined,
      page: page.value,
      pageSize: pageSize.value
    })
    list.value = res.rows
    total.value = res.total
    summary.value = res.summary || summary.value
  } finally {
    loading.value = false
  }
}

/** 改查询条件：回到第一页再查 */
function search() {
  page.value = 1
  load()
}

/**
 * 按订单号查：自动清掉时间区间。
 * 订单号是唯一标识，再叠加「近一月」很容易明明有单却查不到。
 */
function searchByOrderNo() {
  if (keyword.value && keyword.value.trim()) range.value = null
  search()
}

watch([page, pageSize], () => load())

/** 未关联退货（负数冲减单）可撤销：管理员全部，其他人只能撤自己处理的 */
function canRevokeReturn(row) {
  if (row.type !== 'RETURN' || !row.returnId) return false
  if (auth.isAdmin || auth.has('sale:edit:all')) return true
  return row.returnOperatorId != null && row.returnOperatorId === auth.user?.id
}

async function revokeReturn(row) {
  try {
    await ElMessageBox.confirm(
      `撤销后：库存扣回 ${Math.abs(row.itemCount)} 件，营业额恢复 ¥${Math.abs(row.totalAmount).toFixed(2)}，` +
        `这条冲减单和对应退货记录都会被删除。确认撤销？`,
      '撤销退货',
      { type: 'warning', confirmButtonText: '确认撤销', cancelButtonText: '取消' }
    )
  } catch (e) {
    return
  }
  try {
    const res = await returnApi.revoke(row.returnId)
    ElMessage.success(`已撤销，库存已扣回至 ${res.stock} 件`)
    load()
  } catch (e) {
    /* handled */
  }
}

async function showDetail(row) {
  detail.value = await saleApi.detail(row.id)
  detailVisible.value = true
}

/* ---------- 修改销售单 ---------- */
const editVisible = ref(false)
const saving = ref(false)
const editForm = ref({ id: null, orderNo: '', storeName: '', operator: '', remark: '', items: [] })

/** 管理员 / 被授权 sale:edit:all 的人可改全店，其余人只能改自己开的单 */
function canEdit(row) {
  // 退货冲减单不允许在这里改，要退/改到「退货处理」里操作
  if (row.type === 'RETURN') return false
  // 管理员天生全权限，直接放行（也避免旧登录态里权限快照过期导致按钮消失）
  if (auth.isAdmin) return true
  if (!auth.has?.('sale:edit')) return false
  if (auth.has('sale:edit:all')) return true
  return row.operatorId != null && row.operatorId === auth.user?.id
}

const editTotal = computed(() =>
  (editForm.value.items || []).reduce((s, i) => s + i.quantity * i.unitPrice, 0)
)

function openEdit(row) {
  editForm.value = {
    id: row.id,
    orderNo: row.orderNo,
    storeName: row.storeName,
    operator: row.operator,
    remark: row.remark || '',
    items: (row.items || []).map((i) => ({
      id: i.id,
      sku: i.sku,
      name: i.name,
      // 这里编辑的是「有效件数」：退掉的那部分单独记在 returnedQty 里
      quantity: i.quantity - (i.returnedQty || 0),
      returnedQty: i.returnedQty || 0,
      unitPrice: i.unitPrice
    }))
  }
  editVisible.value = true
}

async function saveEdit() {
  saving.value = true
  try {
    await saleApi.updateOrder(editForm.value.id, {
      items: editForm.value.items.map((i) => ({
        id: i.id,
        quantity: i.quantity,
        unitPrice: i.unitPrice
      })),
      remark: editForm.value.remark
    })
    ElMessage.success('已保存修改')
    editVisible.value = false
    load()
  } finally {
    saving.value = false
  }
}

watch(
  () => auth.storeId,
  () => {
    page.value = 1
    load()
  }
)
onMounted(load)
</script>

<style scoped lang="scss">
/* 净额为 0 但有调整：短横 + 淡灰问号，悬停变品牌色给解释 */
.mixed {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.mixed .dash {
  color: #c7c9d6;
}

/* 退货列：金额 + 件数两行，避免「已退 ¥299」被误读成整单全退 */
.ret-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.35;
}

.ret-sub {
  font-size: 11px;
  color: #9b9bb0;
}

.q-mark {
  font-size: 13px;
  color: #c2c4d2;
  cursor: help;
  transition: color 0.15s, transform 0.15s;
}

.q-mark:hover {
  color: var(--brand);
  transform: scale(1.15);
}

/* 修改弹窗底部：调整后合计 */
.edit-sum {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
}
</style>
