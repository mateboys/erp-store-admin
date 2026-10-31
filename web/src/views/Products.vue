<template>
  <div class="page fill">
    <div class="page-card">
      <div class="flex-between" style="flex-wrap: wrap">
        <div>
          <h3 class="page-title">商品管理</h3>
          <div class="page-sub">
            货号全局唯一 · 类别依据尼斯分类（第25类服装鞋帽等）
            <el-tag v-if="!canEdit" size="small" type="info" effect="plain" round style="margin-left: 8px">
              只读（可查看与打印标签）
            </el-tag>
          </div>
        </div>
        <div class="flex" style="flex-wrap: wrap">
          <el-input
            v-model="keyword"
            placeholder="货号 / 品名"
            clearable
            style="width: 200px"
            :prefix-icon="Search"
            @keyup.enter="search"
            @clear="search"
          />
          <el-button
            :icon="Printer"
            :disabled="!selected.length"
            @click="openPrint(selected)"
          >
            打印标签{{ selected.length ? `（${selected.length}）` : '' }}
          </el-button>
          <el-button v-if="canEdit" type="primary" :icon="Plus" @click="openCreate">新增商品</el-button>
        </div>
      </div>

      <div class="table-fill">
        <el-table
          ref="tableRef"
          :data="list"
          v-loading="loading"
          height="100%"
          @selection-change="(v) => (selected = v)"
        >
          <el-table-column type="selection" width="46" />
          <el-table-column label="图片" width="70">
            <template #default="{ row }">
              <el-image
                :src="imgUrl(row.image)"
                fit="cover"
                class="product-thumb"
                :preview-src-list="row.image ? [imgUrl(row.image)] : []"
              >
                <template #error><div class="product-thumb" /></template>
              </el-image>
            </template>
          </el-table-column>
          <el-table-column prop="sku" label="货号" width="120" />
          <el-table-column label="机读条码" width="150">
            <template #default="{ row }">
              <span v-if="row.barcode" class="mono">{{ row.barcode }}</span>
              <span v-else class="muted">-</span>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="品名" min-width="150" show-overflow-tooltip />
          <el-table-column label="商品类型" min-width="180">
            <template #default="{ row }">
              <el-tag v-if="row.categoryName" size="small" type="primary" effect="light">
                {{ row.categoryName }}
              </el-tag>
              <span v-if="row.categoryGroup" class="muted" style="font-size: 12px; margin-left: 6px">
                {{ row.categoryGroup }}
              </span>
              <span v-if="!row.categoryName">-</span>
            </template>
          </el-table-column>
          <el-table-column label="库存" width="90" align="right">
            <template #default="{ row }">
              <span v-if="row.stock != null" :style="{ color: row.stock <= 5 ? '#d63031' : '' }">
                {{ row.stock }}
              </span>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column label="销售价" width="100" align="right">
            <template #default="{ row }">
              <span v-if="row.salePrice">¥{{ row.salePrice.toFixed(2) }}</span>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column v-if="auth.canSeeCost" label="成本价" width="100" align="right">
            <template #default="{ row }">
              <!-- 优先显示商品档案里设的成本价，没有再退回库存移动加权均价 -->
              <span v-if="row.costPrice != null">¥{{ row.costPrice.toFixed(2) }}</span>
              <span v-else-if="row.avgCost">¥{{ row.avgCost.toFixed(2) }}</span>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <!-- 操作列所有人可见：无管理权限的账号只保留「标签」（查看/打印） -->
          <el-table-column
            label="操作"
            :width="canEdit ? 200 : 90"
            class-name="col-ops"
            fixed="right"
          >
            <template #default="{ row }">
              <el-button link type="primary" :icon="Printer" @click="openPrint([row])">标签</el-button>
              <template v-if="canEdit">
                <el-button link type="primary" :icon="Edit" @click="openEdit(row)">编辑</el-button>
                <el-button link type="danger" :icon="Delete" @click="remove(row)">删除</el-button>
              </template>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty description="暂无商品" />
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

    <el-dialog v-model="visible" :title="form.id ? '编辑商品' : '新增商品'" width="560px">
      <el-form :model="form" label-width="90px" :rules="rules" ref="formRef">
        <el-form-item label="货号" prop="sku">
          <el-input
            v-model="form.sku"
            placeholder="请输入货号（全局唯一，也是扫码识别的编码）"
            @blur="checkSku"
          />
          <div v-if="skuTip" style="font-size: 12px; margin-top: 4px" :style="{ color: skuTip.color }">
            {{ skuTip.text }}
          </div>
        </el-form-item>
        <el-form-item label="机读条码" prop="barcode">
          <el-input
            v-model="form.barcode"
            placeholder="EAN-13，13 位数字（自动生成）"
            maxlength="13"
            class="mono"
            @input="barcodeTip = null"
            @blur="checkBarcode"
          >
            <template #append>
              <el-button :icon="Refresh" :loading="genBarcodeing" @click="regenBarcode">
                换一个
              </el-button>
            </template>
          </el-input>
          <div
            v-if="barcodeTip"
            style="font-size: 12px; margin-top: 4px"
            :style="{ color: barcodeTip.color }"
          >
            {{ barcodeTip.text }}
          </div>
          <div v-else class="muted" style="font-size: 12px; margin-top: 4px">
            扫码枪扫的就是这个码，与给人看的货号互相独立
          </div>
        </el-form-item>
        <el-form-item label="品名" prop="name">
          <el-input v-model="form.name" placeholder="如：男士直筒牛仔裤" />
        </el-form-item>
        <el-form-item label="商品类型">
          <el-select
            v-model="form.categoryId"
            filterable
            clearable
            placeholder="可输入关键字模糊搜索，如：裤子 / T恤 / 鞋"
            style="width: 100%"
          >
            <el-option-group
              v-for="cls in grouped"
              :key="cls.niceClass"
              :label="cls.title"
            >
              <el-option-group
                v-for="g in cls.groups"
                :key="g.groupCode"
                :label="`${g.groupCode} ${g.groupName}`"
              >
                <el-option v-for="c in g.children" :key="c.id" :label="c.name" :value="c.id" />
              </el-option-group>
            </el-option-group>
          </el-select>
        </el-form-item>
        <el-form-item label="销售价">
          <el-input-number
            v-model="form.salePrice"
            :min="0"
            :precision="2"
            :step="1"
            :controls="false"
            style="width: 100%"
            placeholder="如 299"
          />
          <div class="muted" style="font-size: 12px; width: 100%">
            入库与销售都取这个价，入库页不再单独填售价
          </div>
        </el-form-item>
        <el-form-item v-if="auth.canSeeCost" label="成本价">
          <el-input-number
            v-model="form.costPrice"
            :min="0"
            :precision="2"
            :step="1"
            :controls="false"
            style="width: 100%"
            placeholder="如 128"
          />
          <div class="muted" style="font-size: 12px; width: 100%">
            作为入库时进货价的默认值，可按实际进价现场修改
          </div>
        </el-form-item>
        <el-form-item label="商品图片">
          <el-upload
            class="uploader"
            :show-file-list="false"
            :http-request="doUpload"
            accept="image/*"
          >
            <img v-if="form.image" :src="imgUrl(form.image)" class="upload-img" />
            <div v-else class="upload-placeholder">
              <el-icon><Plus /></el-icon>
              <div style="font-size: 12px; margin-top: 4px">上传图片（可选）</div>
            </div>
          </el-upload>
          <el-button
            v-if="form.image"
            link
            type="danger"
            style="margin-left: 10px"
            @click="form.image = null"
          >
            移除
          </el-button>
          <div class="muted" style="font-size: 12px; width: 100%">不上传则使用系统默认图片</div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="printVisible" title="商品标签" width="880px" top="4vh">
      <div class="flex-between" style="flex-wrap: wrap; margin-bottom: 12px">
        <span class="muted" style="font-size: 13px">
          条形码与二维码编码的都是商品的 <b>EAN-13 机读条码</b>，扫任意一种都能定位到商品；
          货号只印在标签上给人看，不参与扫码
        </span>
        <div class="flex">
          <span class="muted" style="font-size: 13px">每款打印</span>
          <el-input-number v-model="copies" :min="1" :max="20" size="small" style="width: 110px" />
          <span class="muted" style="font-size: 13px">份</span>
          <el-button type="primary" :icon="Printer" @click="doPrint">打印</el-button>
        </div>
      </div>

      <div class="print-area">
        <div class="label-sheet">
          <BarcodeLabel
            v-for="(p, i) in printList"
            :key="`${p.id}-${i}`"
            :sku="p.sku"
            :barcode="p.barcode"
            :name="p.name"
            :price="p.salePrice"
          />
        </div>
      </div>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        style="margin-top: 14px"
        title="打印建议在浏览器打印对话框里关闭「页眉页脚」，边距设为无；标签纸常用 60×40mm，一页可排多张"
      />
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Edit, Delete, Printer, Refresh } from '@element-plus/icons-vue'
import BarcodeLabel from '@/components/BarcodeLabel.vue'
import { productApi, categoryApi } from '@/api'
import { useUserStore } from '@/stores/user'
import { isValidEan13 } from '@/utils/ean13'

const auth = useUserStore()
/** 商品档案的维护权限（新增/编辑/删除），默认仅管理员 */
const canEdit = computed(() => auth.has('product:create'))
const list = ref([])
const grouped = ref([])
const loading = ref(false)
const keyword = ref('')
/* 分页 */
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const visible = ref(false)
const submitting = ref(false)
const formRef = ref()
const skuTip = ref(null)
/** 机读条码（EAN-13）的校验提示 */
const barcodeTip = ref(null)
const genBarcodeing = ref(false)

const form = ref({
  id: null,
  sku: '',
  barcode: '',
  name: '',
  categoryId: null,
  salePrice: null,
  costPrice: null,
  image: null,
  remark: ''
})

/* ---------- 标签打印 ---------- */
const tableRef = ref()
const selected = ref([])
const printVisible = ref(false)
const copies = ref(1)
const printRows = ref([])
/** 按份数展开后的标签列表 */
const printList = computed(() => {
  const out = []
  for (let i = 0; i < copies.value; i++) out.push(...printRows.value)
  return out
})

function openPrint(rows) {
  if (!rows?.length) return
  printRows.value = rows.map((r) => ({ ...r }))
  copies.value = 1
  printVisible.value = true
}

function doPrint() {
  window.print()
}

const rules = {
  sku: [{ required: true, message: '请输入货号', trigger: 'blur' }],
  name: [{ required: true, message: '请输入品名', trigger: 'blur' }],
  barcode: [
    {
      validator: (_r, v, cb) =>
        isValidEan13(v) ? cb() : cb(new Error('条码须为 13 位数字且符合 EAN-13 校验规则')),
      trigger: 'blur'
    }
  ]
}

/** 重新取一个库内未占用的 EAN-13 */
async function regenBarcode(silent = false) {
  genBarcodeing.value = true
  try {
    const res = await productApi.nextBarcode()
    form.value.barcode = res.barcode
    barcodeTip.value = null
  } catch (e) {
    if (!silent) ElMessage.error('条码生成失败，请重试')
  } finally {
    genBarcodeing.value = false
  }
}

/** 失焦时校验条码合法性与占用情况 */
async function checkBarcode() {
  const code = (form.value.barcode || '').trim()
  if (!code) {
    barcodeTip.value = null
    return
  }
  if (!isValidEan13(code)) {
    barcodeTip.value = { color: '#d63031', text: '不是合法的 EAN-13：需 13 位数字且校验位正确' }
    return
  }
  const res = await productApi.checkBarcode(code, form.value.id)
  barcodeTip.value = res.exists
    ? { color: '#d63031', text: `条码已被商品「${res.product?.name || ''}」占用` }
    : { color: '#00b894', text: '条码可用' }
}

function imgUrl(u) {
  if (!u) return defaultImg()
  return u.startsWith('http') ? u : u
}

function defaultImg() {
  return 'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" fill="#f0f0f7"/><text x="22" y="27" font-size="14" fill="#b6b6cc" text-anchor="middle">衣</text></svg>`
    )
}

async function load() {
  loading.value = true
  try {
    const res = await productApi.list({
      keyword: keyword.value,
      storeId: auth.storeId,
      page: page.value,
      pageSize: pageSize.value
    })
    list.value = res.rows
    total.value = res.total
  } finally {
    loading.value = false
  }
}

async function loadCategories() {
  grouped.value = await categoryApi.grouped()
}

/** 搜索 / 清空条件：回到第一页再查 */
function search() {
  page.value = 1
  load()
}

watch([page, pageSize], () => load())

async function checkSku() {
  if (!form.value.sku) {
    skuTip.value = null
    return
  }
  const res = await productApi.checkSku(form.value.sku, form.value.id)
  skuTip.value = res.exists
    ? { color: '#d63031', text: `货号「${form.value.sku}」已存在：${res.product?.name || ''}` }
    : { color: '#00b894', text: '货号可用' }
}

async function openCreate() {
  form.value = {
    id: null,
    sku: '',
    barcode: '',
    name: '',
    categoryId: null,
    salePrice: null,
    costPrice: null,
    image: null,
    remark: ''
  }
  skuTip.value = null
  barcodeTip.value = null
  visible.value = true
  // 新增时自动生成一条库内唯一的 EAN-13
  await regenBarcode(true)
}

function openEdit(row) {
  form.value = {
    id: row.id,
    sku: row.sku,
    barcode: row.barcode || '',
    name: row.name,
    categoryId: row.categoryId,
    salePrice: row.salePrice ?? null,
    costPrice: row.costPrice ?? null,
    image: row.image,
    remark: row.remark
  }
  skuTip.value = null
  barcodeTip.value = null
  visible.value = true
}

async function doUpload({ file }) {
  const fd = new FormData()
  fd.append('file', file)
  const res = await productApi.upload(fd)
  form.value.image = res.url
}

async function submit() {
  await formRef.value.validate()
  if (skuTip.value?.color === '#d63031') {
    return ElMessage.error('货号重复，请修改')
  }
  if (barcodeTip.value?.color === '#d63031') {
    return ElMessage.error('机读条码不可用，请点「换一个」')
  }
  submitting.value = true
  try {
    const payload = { ...form.value }
    if (!payload.categoryId) payload.categoryId = null
    if (payload.id) {
      await productApi.update(payload.id, payload)
    } else {
      await productApi.create(payload)
    }
    ElMessage.success('保存成功')
    visible.value = false
    load()
  } finally {
    submitting.value = false
  }
}

async function remove(row) {
  await ElMessageBox.confirm(`确认删除商品「${row.name}」？`, '提示', { type: 'warning' })
  await productApi.remove(row.id)
  ElMessage.success('已删除')
  // 删掉的是当前页最后一条时往前退一页，避免停在空白页
  if (list.value.length === 1 && page.value > 1) page.value -= 1
  else load()
}

onMounted(() => {
  load()
  loadCategories()
})

defineExpose({ load })
</script>

<style scoped lang="scss">
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0.5px;
}

.uploader :deep(.el-upload) {
  border: 1px dashed #d6d6e6;
  border-radius: 10px;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.2s;

  &:hover {
    border-color: var(--brand);
  }
}

.upload-img {
  width: 110px;
  height: 110px;
  object-fit: cover;
  display: block;
}

.upload-placeholder {
  width: 110px;
  height: 110px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #9a9ab5;
}
</style>
