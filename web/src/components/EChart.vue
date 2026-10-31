<template>
  <div ref="el" :style="{ width: '100%', height }"></div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import * as echarts from 'echarts'

const props = defineProps({
  option: { type: Object, required: true },
  height: { type: String, default: '320px' }
})

const el = ref(null)
let chart = null
let ro = null

function render() {
  if (!chart) return
  chart.setOption(props.option, true)
}

function resize() {
  chart && chart.resize()
}

onMounted(async () => {
  await nextTick()
  chart = echarts.init(el.value)
  render()
  window.addEventListener('resize', resize)
  // 容器宽度变化（侧栏折叠、栅格重排、数据加载后页面变窄）不会触发 window resize，
  // 只靠上面的监听图会僵在首次测量的宽度上，看起来就偏宽/偏窄
  if (typeof ResizeObserver !== 'undefined' && el.value) {
    ro = new ResizeObserver(() => resize())
    ro.observe(el.value)
  }
})

watch(() => props.option, render, { deep: true })

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  if (ro) ro.disconnect()
  if (chart) chart.dispose()
})
</script>
