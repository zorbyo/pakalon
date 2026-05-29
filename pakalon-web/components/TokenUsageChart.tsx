'use client'

import { useMemo } from 'react'

import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts'

interface ChartDataPoint {
    name: string
    tokens: number
    fullLabel?: string
}

interface Props {
    data?: ChartDataPoint[]
}

function formatTokenTick(value: number) {
    if (value >= 1_000_000) {
        return `${Number((value / 1_000_000).toFixed(1))}m`
    }

    if (value >= 1_000) {
        return `${Number((value / 1_000).toFixed(1))}k`
    }

    return value.toLocaleString()
}

function getNiceAxisMax(value: number) {
    if (value <= 0) return 100

    const headroomValue = value * 1.15
    const magnitude = 10 ** Math.floor(Math.log10(headroomValue))
    const normalized = headroomValue / magnitude

    if (normalized <= 1) return magnitude
    if (normalized <= 2) return 2 * magnitude
    if (normalized <= 5) return 5 * magnitude
    return 10 * magnitude
}

function buildAxisTicks(maxValue: number) {
    return Array.from(new Set(Array.from({ length: 5 }, (_, index) => Math.round((maxValue / 4) * index))))
}

const EMPTY_DATA: ChartDataPoint[] = Array.from({ length: 7 }, (_, i) => ({
    name: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i],
    tokens: 0,
}))

export default function TokenUsageChart({ data }: Props) {
    const chartData = data && data.length > 0 ? data : EMPTY_DATA
    const maxValue = useMemo(
        () => chartData.reduce((largest, item) => Math.max(largest, item.tokens), 0),
        [chartData],
    )
    const yAxisMax = useMemo(() => getNiceAxisMax(maxValue), [maxValue])
    const yAxisTicks = useMemo(() => buildAxisTicks(yAxisMax), [yAxisMax])

    return (
        <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#34362b" />
                    <XAxis
                        dataKey="name"
                        stroke="#b1b4a2"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={10}
                        tickFormatter={(val) => (typeof val === 'string' && val.includes('___') ? val.split('___')[1] : val)}
                    />
                    <YAxis
                        stroke="#b1b4a2"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        width={60}
                        domain={[0, yAxisMax]}
                        ticks={yAxisTicks}
                        allowDecimals={false}
                        tickFormatter={formatTokenTick}
                    />
                    <Tooltip
                        cursor={{ fill: '#ffffff10' }}
                        contentStyle={{
                            backgroundColor: '#25261e',
                            border: '1px solid #34362b',
                            borderRadius: '8px',
                        }}
                        itemStyle={{ color: '#d7e19d' }}
                        labelStyle={{ color: '#b1b4a2' }}
                        labelFormatter={(label, payload) => payload?.[0]?.payload?.fullLabel ?? label}
                        formatter={(value: number) => [`${value.toLocaleString()} tokens`, 'Tokens']}
                    />
                    <Bar
                        dataKey="tokens"
                        fill="#d7e19d"
                        radius={[4, 4, 0, 0]}
                    />
                </BarChart>
            </ResponsiveContainer>
        </div>
    )
}
