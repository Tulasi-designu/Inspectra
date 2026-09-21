"use client";

import { useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";

interface InspectionPieChartProps {
  pass: number;
  review: number;
  fail: number;
  notApplicable: number;
  notEvaluated: number;
}

const COLORS: Record<string, string> = {
  Pass: "#22c55e",
  Review: "#f59e0b",
  Fail: "#ef4444",
  "N/A": "#3b82f6",
  "Not Evaluated": "#8b5cf6",
};

export default function InspectionPieChart({
  pass,
  review,
  fail,
  notApplicable,
  notEvaluated,
}: InspectionPieChartProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  const data = [
    { name: "Pass", value: pass },
    { name: "Review", value: review },
    { name: "Fail", value: fail },
    { name: "N/A", value: notApplicable },
    { name: "Not Evaluated", value: notEvaluated },
  ].filter((item) => item.value > 0);

  return (
    <div
      style={{
        width: "100%",
        minHeight: "430px",
        marginTop: "24px",
        marginBottom: "24px",
        padding: "20px",
        border: "1px solid #e2e8f0",
        borderRadius: "16px",
        background: "#ffffff",
      }}
    >
      <h2
        style={{
          fontSize: "20px",
          fontWeight: 600,
          color: "#111827",
          marginBottom: "5px",
        }}
      >
        Inspection Declaration Status
      </h2>

      <div
        style={{
          width: "100%",
          height: "350px",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <PieChart width={600} height={350}>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="45%"
            innerRadius={65}
            outerRadius={120}
            paddingAngle={2}
            label={({ name, value }) => `${name} ${value}`}
            onMouseEnter={(entry) => {
              setHovered(entry.name);
            }}
            onMouseLeave={() => {
              setHovered(null);
            }}
          >
            {data.map((entry) => (
              <Cell
                key={entry.name}
                fill={COLORS[entry.name]}
                opacity={
                  hovered === null || hovered === entry.name
                    ? 1
                    : 0.18
                }
                style={{
                  transition: "opacity 0.25s ease",
                  cursor: "pointer",
                }}
              />
            ))}
          </Pie>

          <Tooltip />

          <Legend
            verticalAlign="bottom"
            height={40}
            content={() => (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: "24px",
                  flexWrap: "wrap",
                  marginTop: "5px",
                }}
              >
                {[
                  { name: "Pass", value: pass },
                  { name: "Review", value: review },
                  { name: "Fail", value: fail },
                  { name: "N/A", value: notApplicable },
                  {
                    name: "Not Evaluated",
                    value: notEvaluated,
                  },
                ].map((item) => (
                  <div
                    key={item.name}
                    onMouseEnter={() => {
                      if (item.value > 0) {
                        setHovered(item.name);
                      }
                    }}
                    onMouseLeave={() => {
                      setHovered(null);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "7px",
                      opacity:
                        hovered === null ||
                        hovered === item.name
                          ? 1
                          : 0.3,
                      transition: "opacity 0.25s ease",
                      cursor:
                        item.value > 0
                          ? "pointer"
                          : "default",
                    }}
                  >
                    <span
                      style={{
                        width: "12px",
                        height: "12px",
                        borderRadius: "50%",
                        backgroundColor: COLORS[item.name],
                        display: "inline-block",
                      }}
                    />

                    <span
                      style={{
                        fontSize: "14px",
                        color: "#374151",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.name} {item.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
          />
        </PieChart>
      </div>
    </div>
  );
}