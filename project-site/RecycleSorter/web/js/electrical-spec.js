// 已拍板的第二段電盤配置；尺寸與未選定型號皆為示意。
// 2026-10-05 拍板：整組系統盤裝進現場既有的電控櫃（layout.js 的 siteCabinet），這裡的 center／backZ 等仍是箱體自己的座標，
// electrical.js 把整個群組轉 180°、移進櫃內；主輸送帶沿用既有驅動，所以拿掉主帶變頻器（D1），元件由 20 個變 19 個。
export const ELECTRICAL_SPEC = {
  "cabinet": {
    "center": [
      300,
      600,
      -1760
    ],
    "size": [
      600,
      1200,
      300
    ],
    "thickness": 20,
    "panel": [
      500,
      900
    ],
    "backZ": -1907,
    "panelCenter": [
      300,
      600,
      -1865
    ],
    "top": 1200,
    "doorFacing": "−Z（朝操作走道）；整組裝在既有電控櫃下游半的上層",
    "entries": [
      {
        "id": "E1",
        "x": -200,
        "z": -80,
        "hole": 16,
        "wire": 6,
        "port": 0,
        "use": "廠務進線 AC 220 V"
      },
      {
        "id": "E2",
        "x": -120,
        "z": -80,
        "hole": 14,
        "wire": 5,
        "port": 1,
        "use": "分流帶馬達動力 ×2"
      },
      {
        "id": "E3",
        "x": -40,
        "z": -80,
        "hole": 14,
        "wire": 5,
        "port": 2,
        "use": "手臂控制器動力與交握"
      },
      {
        "id": "E4",
        "x": 40,
        "z": -80,
        "hole": 12,
        "wire": 4,
        "port": 3,
        "use": "相機 GigE／PoE、光源觸發"
      },
      {
        "id": "E5",
        "x": 120,
        "z": -80,
        "hole": 12,
        "wire": 4,
        "port": 4,
        "use": "感測與 I/O"
      },
      {
        "id": "E6",
        "x": 200,
        "z": -80,
        "hole": 12,
        "wire": 4,
        "port": 5,
        "use": "安全迴路"
      }
    ]
  },
  "rows": [
    {
      "row": 1,
      "y": 105,
      "title": "電源與安全",
      "width": 366,
      "limit": 415
    },
    {
      "row": 2,
      "y": -40,
      "title": "控制與 I/O",
      "width": 341,
      "limit": 415
    },
    {
      "row": 3,
      "y": -185,
      "title": "視覺與通訊",
      "width": 327,
      "limit": 415
    },
    {
      "row": 4,
      "y": -330,
      "title": "驅動",
      "width": 104,
      "limit": 415
    }
  ],
  "components": [
    {
      "id": "QS1",
      "kind": "isolator",
      "title": "總電源隔離開關",
      "size": [
        36,
        75,
        65
      ],
      "role": "power",
      "category": "ac",
      "source": null,
      "row": 1,
      "model": "示意",
      "description": "單相 AC 220 V 20 A 進線隔離，檢修時切斷全機電源（示意）。"
    },
    {
      "id": "QF1",
      "kind": "breaker",
      "title": "控制支路保護",
      "size": [
        36,
        75,
        65
      ],
      "role": "power",
      "category": "ac",
      "source": "QS1",
      "row": 1,
      "model": "示意",
      "description": "供 24 V 電源與視覺工業電腦，與動力分路分開。"
    },
    {
      "id": "QF2",
      "kind": "breaker",
      "title": "動力支路保護",
      "size": [
        36,
        75,
        65
      ],
      "role": "power",
      "category": "ac",
      "source": "QS1",
      "row": 1,
      "model": "示意",
      "description": "供兩台分流帶變頻器與手臂控制器。"
    },
    {
      "id": "PS1",
      "kind": "psu",
      "title": "24 VDC 電源 240 W",
      "size": [
        50,
        95,
        100
      ],
      "role": "power",
      "category": "ac",
      "source": "QF1",
      "row": 1,
      "model": "示意",
      "description": "負載概算 160 W：PLC／I/O、交換器含 PoE、安全控制器、光源控制器頻閃峰值、HMI、閥與感測。"
    },
    {
      "id": "GC1",
      "kind": "safety",
      "title": "安全控制器",
      "size": [
        60,
        90,
        95
      ],
      "role": "safety",
      "category": "dc",
      "source": "PS1",
      "row": 1,
      "model": "示意",
      "description": "收安全光柵 OSSD ×2 與急停 ×2，雙通道輸出切斷動力，另接手臂控制器的安全輸入；目標 PL d／Cat. 3，須另做風險評估。"
    },
    {
      "id": "K1",
      "kind": "contactor",
      "title": "動力切斷接觸器 A",
      "size": [
        32,
        75,
        70
      ],
      "role": "safety",
      "category": "safety",
      "source": "GC1",
      "row": 1,
      "model": "示意",
      "description": "安全輸出第一通道，輔助接點回授 IO2。"
    },
    {
      "id": "K2",
      "kind": "contactor",
      "title": "動力切斷接觸器 B",
      "size": [
        32,
        75,
        70
      ],
      "role": "safety",
      "category": "safety",
      "source": "GC1",
      "row": 1,
      "model": "示意",
      "description": "安全輸出第二通道，與 K1 串接。"
    },
    {
      "id": "PLC1",
      "kind": "plc",
      "title": "設備 PLC",
      "size": [
        80,
        90,
        85
      ],
      "role": "control",
      "category": "dc",
      "source": "PS1",
      "row": 2,
      "model": "示意",
      "description": "站序與互鎖；收 IPC1 的物件清單做抓取排程，經 GW1 下命令給手臂控制器。"
    },
    {
      "id": "HSC1",
      "kind": "io",
      "title": "編碼器高速計數模組",
      "size": [
        40,
        80,
        65
      ],
      "role": "io",
      "category": "signal",
      "source": "PLC1",
      "row": 2,
      "model": "示意",
      "description": "輥徑 Ø100、1000 ppr 四倍頻＝0.0785 mm／計數；每 200 mm 輸出一次取像觸發，並提供手臂追蹤基準。"
    },
    {
      "id": "IO1",
      "kind": "io",
      "title": "數位 I/O（感測與指示）",
      "size": [
        50,
        80,
        65
      ],
      "role": "io",
      "category": "signal",
      "source": "PLC1",
      "row": 2,
      "model": "示意",
      "description": "入料光電、三色警示燈、頻閃觸發允許。"
    },
    {
      "id": "IO2",
      "kind": "io",
      "title": "數位 I/O（安全回授）",
      "size": [
        50,
        80,
        65
      ],
      "role": "io",
      "category": "signal",
      "source": "PLC1",
      "row": 2,
      "model": "示意",
      "description": "急停與 K1／K2 輔助接點回授、復歸按鈕、光柵狀態監看；接點未跳脫時鎖定不允許復歸。"
    },
    {
      "id": "VAC1",
      "kind": "io",
      "title": "真空／氣壓介面",
      "size": [
        65,
        75,
        65
      ],
      "role": "vacuum",
      "category": "signal",
      "source": "IO1",
      "row": 2,
      "model": "示意",
      "description": "工具電磁閥輸出與真空開關、氣源壓力開關回授。"
    },
    {
      "id": "SW1",
      "kind": "switch",
      "title": "工業乙太網交換器（8 埠含 PoE）",
      "size": [
        40,
        80,
        70
      ],
      "role": "network",
      "category": "dc",
      "source": "PS1",
      "row": 3,
      "model": "示意",
      "description": "連接 PLC、視覺電腦、相機 ×2（PoE）、手臂閘道與 HMI。"
    },
    {
      "id": "IPC1",
      "kind": "ipc",
      "title": "視覺工業電腦（GPU 推論）",
      "size": [
        160,
        95,
        100
      ],
      "role": "vision",
      "category": "network",
      "source": "SW1",
      "row": 3,
      "model": "示意",
      "description": "雙相機取像、實例分割與材質／食品屬性分類、視差求頂面高度與長軸角度；清單附編碼器計數送 PLC。AC 直供，連線圖上畫的是網路連線。"
    },
    {
      "id": "LC1",
      "kind": "light",
      "title": "頻閃光源控制器（2 ch）",
      "size": [
        45,
        70,
        70
      ],
      "role": "vision",
      "category": "signal",
      "source": "IO1",
      "row": 3,
      "model": "示意",
      "description": "依編碼器觸發驅動兩支低角度條燈，亮 2 ms；取像時指示燈隨主時間軸亮。"
    },
    {
      "id": "GW1",
      "kind": "gateway",
      "title": "手臂交握閘道",
      "size": [
        40,
        70,
        55
      ],
      "role": "network",
      "category": "network",
      "source": "SW1",
      "row": 3,
      "model": "示意",
      "description": "PLC ↔ 手臂控制器的抓取命令、完成與異常狀態。"
    },
    {
      "id": "D2",
      "kind": "drive",
      "title": "分流帶 A 變頻器",
      "size": [
        45,
        100,
        110
      ],
      "role": "motion",
      "category": "ac",
      "source": "QF2",
      "row": 4,
      "model": "示意",
      "description": "食品 HDPE 出料帶，帶速 0.3 m/s。"
    },
    {
      "id": "D3",
      "kind": "drive",
      "title": "分流帶 B 變頻器",
      "size": [
        45,
        100,
        110
      ],
      "role": "motion",
      "category": "ac",
      "source": "QF2",
      "row": 4,
      "model": "示意",
      "description": "非食品 HDPE 出料帶，帶速 0.3 m/s。"
    },
    {
      "id": "RC1",
      "kind": "robot",
      "title": "手臂控制器",
      "size": [
        357,
        94,
        320
      ],
      "role": "motion",
      "category": "ac",
      "source": "QF2",
      "free": true,
      "at": [
        -1325,
        300,
        -1310
      ],
      "model": "RC8A 標準型包絡（示意）",
      "description": "裝在既有電控櫃下游半的下層（系統盤正下方）、面板朝操作走道（−Z）；以外掛編碼器同步做 conveyor tracking，經 GW1 與 PLC 交握。用 core 的 robotController() 建，建完要補 userData.electrical.free = true。"
    }
  ]
};
