// js/fixtures/grid_samples.js — DEV MOCK ONLY. Loaded solely when the URL has ?gridMock=1.
// Generated from the real trading_system compute_grid (step 3) with stubbed quotes/levels/legs
// (market closed). Do not reference from production code paths.
window.SV_GRID_FIXTURES = {
 "signal_0dte_call": {
  "available": true,
  "mode": "signal",
  "contract": {
   "ticker": "SPY",
   "strike": 501.0,
   "expiry": "2026-11-20",
   "right": "call",
   "option_symbol": "SPY261120C00501000"
  },
  "position_id": null,
  "qty": 2,
  "now": "2026-11-20T10:05:00-05:00",
  "spot": 500.0,
  "spot_source": "engine_live",
  "basis": {
   "type": "ask",
   "price": 0.64
  },
  "cost": null,
  "mid": 0.62,
  "sigma_trading": 0.084777,
  "iv_display": 0.196052,
  "sigma_source": "back_solved_mid",
  "daily_atr": 6.2,
  "prev_close": 499.1,
  "atr_anchor_date": "2026-11-19",
  "columns": [
   {
    "label": "Now",
    "ts": "2026-11-20T10:05:00-05:00",
    "t_years": 0.003612128612128612,
    "is_expiry": false,
    "low_confidence": false,
    "expected_move_1sigma": 0.0
   },
   {
    "label": "11:00",
    "ts": "2026-11-20T11:00:00-05:00",
    "t_years": 0.0030525030525030525,
    "is_expiry": false,
    "low_confidence": false,
    "expected_move_1sigma": 1.0028
   },
   {
    "label": "12:00",
    "ts": "2026-11-20T12:00:00-05:00",
    "t_years": 0.002442002442002442,
    "is_expiry": false,
    "low_confidence": false,
    "expected_move_1sigma": 1.45
   },
   {
    "label": "13:00",
    "ts": "2026-11-20T13:00:00-05:00",
    "t_years": 0.0018315018315018315,
    "is_expiry": false,
    "low_confidence": false,
    "expected_move_1sigma": 1.7887
   },
   {
    "label": "14:00",
    "ts": "2026-11-20T14:00:00-05:00",
    "t_years": 0.001221001221001221,
    "is_expiry": false,
    "low_confidence": false,
    "expected_move_1sigma": 2.0728
   },
   {
    "label": "15:00",
    "ts": "2026-11-20T15:00:00-05:00",
    "t_years": 0.0006105006105006105,
    "is_expiry": false,
    "low_confidence": true,
    "expected_move_1sigma": 2.3223
   },
   {
    "label": "15:30",
    "ts": "2026-11-20T15:30:00-05:00",
    "t_years": 0.00030525030525030525,
    "is_expiry": false,
    "low_confidence": true,
    "expected_move_1sigma": 2.4376
   },
   {
    "label": "15:45",
    "ts": "2026-11-20T15:45:00-05:00",
    "t_years": 0.00015262515262515263,
    "is_expiry": false,
    "low_confidence": true,
    "expected_move_1sigma": 2.4932
   },
   {
    "label": "Expiry",
    "ts": "2026-11-20T16:00:00-05:00",
    "t_years": 0.0,
    "is_expiry": true,
    "low_confidence": true,
    "expected_move_1sigma": 2.5476
   }
  ],
  "rows": [
   {
    "name": "Round above",
    "tag": "RND↑",
    "price": 510.0,
    "pct_from_spot": 2.0,
    "role": "sr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 9.0725,
      "beyond_1sigma": false,
      "pnl": 1686.5,
      "pct": 1317.58
     },
     {
      "value": 9.0612,
      "beyond_1sigma": true,
      "pnl": 1684.24,
      "pct": 1315.81
     },
     {
      "value": 9.0489,
      "beyond_1sigma": true,
      "pnl": 1681.79,
      "pct": 1313.9
     },
     {
      "value": 9.0367,
      "beyond_1sigma": true,
      "pnl": 1679.34,
      "pct": 1311.98
     },
     {
      "value": 9.0245,
      "beyond_1sigma": true,
      "pnl": 1676.89,
      "pct": 1310.07
     },
     {
      "value": 9.0122,
      "beyond_1sigma": true,
      "pnl": 1674.45,
      "pct": 1308.16
     },
     {
      "value": 9.0061,
      "beyond_1sigma": true,
      "pnl": 1673.22,
      "pct": 1307.21
     },
     {
      "value": 9.0031,
      "beyond_1sigma": true,
      "pnl": 1672.61,
      "pct": 1306.73
     },
     {
      "value": 9.0,
      "beyond_1sigma": true,
      "pnl": 1672.0,
      "pct": 1306.25
     }
    ]
   },
   {
    "name": "Overhead swing 2",
    "tag": "OH2",
    "price": 506.5,
    "pct_from_spot": 1.3,
    "role": "sr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 5.586,
      "beyond_1sigma": false,
      "pnl": 989.2,
      "pct": 772.81
     },
     {
      "value": 5.5685,
      "beyond_1sigma": true,
      "pnl": 985.69,
      "pct": 770.07
     },
     {
      "value": 5.5517,
      "beyond_1sigma": true,
      "pnl": 982.35,
      "pct": 767.46
     },
     {
      "value": 5.5373,
      "beyond_1sigma": true,
      "pnl": 979.47,
      "pct": 765.21
     },
     {
      "value": 5.5245,
      "beyond_1sigma": true,
      "pnl": 976.9,
      "pct": 763.2
     },
     {
      "value": 5.5122,
      "beyond_1sigma": true,
      "pnl": 974.45,
      "pct": 761.29
     },
     {
      "value": 5.5061,
      "beyond_1sigma": true,
      "pnl": 973.22,
      "pct": 760.33
     },
     {
      "value": 5.5031,
      "beyond_1sigma": true,
      "pnl": 972.61,
      "pct": 759.85
     },
     {
      "value": 5.5,
      "beyond_1sigma": true,
      "pnl": 972.0,
      "pct": 759.38
     }
    ]
   },
   {
    "name": "ATR +1× (prior close 499.10)",
    "tag": "ATR+1",
    "price": 505.3,
    "pct_from_spot": 1.06,
    "role": "atr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 4.4186,
      "beyond_1sigma": false,
      "pnl": 755.72,
      "pct": 590.41
     },
     {
      "value": 4.3907,
      "beyond_1sigma": true,
      "pnl": 750.15,
      "pct": 586.05
     },
     {
      "value": 4.364,
      "beyond_1sigma": true,
      "pnl": 744.8,
      "pct": 581.88
     },
     {
      "value": 4.342,
      "beyond_1sigma": true,
      "pnl": 740.41,
      "pct": 578.44
     },
     {
      "value": 4.3253,
      "beyond_1sigma": true,
      "pnl": 737.05,
      "pct": 575.82
     },
     {
      "value": 4.3122,
      "beyond_1sigma": true,
      "pnl": 734.45,
      "pct": 573.79
     },
     {
      "value": 4.3061,
      "beyond_1sigma": true,
      "pnl": 733.22,
      "pct": 572.83
     },
     {
      "value": 4.3031,
      "beyond_1sigma": true,
      "pnl": 732.61,
      "pct": 572.35
     },
     {
      "value": 4.3,
      "beyond_1sigma": true,
      "pnl": 732.0,
      "pct": 571.88
     }
    ]
   },
   {
    "name": "Overhead swing 1",
    "tag": "OH1",
    "price": 503.2,
    "pct_from_spot": 0.64,
    "role": "sr",
    "is_target": true,
    "is_stop": false,
    "merged": [
     "ATR+0.618"
    ],
    "cells": [
     {
      "value": 2.5348,
      "beyond_1sigma": false,
      "pnl": 378.97,
      "pct": 296.07
     },
     {
      "value": 2.4719,
      "beyond_1sigma": true,
      "pnl": 366.37,
      "pct": 286.23
     },
     {
      "value": 2.4023,
      "beyond_1sigma": true,
      "pnl": 352.46,
      "pct": 275.36
     },
     {
      "value": 2.3332,
      "beyond_1sigma": true,
      "pnl": 338.64,
      "pct": 264.56
     },
     {
      "value": 2.2685,
      "beyond_1sigma": true,
      "pnl": 325.7,
      "pct": 254.45
     },
     {
      "value": 2.219,
      "beyond_1sigma": true,
      "pnl": 315.79,
      "pct": 246.71
     },
     {
      "value": 2.2064,
      "beyond_1sigma": true,
      "pnl": 313.29,
      "pct": 244.76
     },
     {
      "value": 2.2031,
      "beyond_1sigma": true,
      "pnl": 312.61,
      "pct": 244.23
     },
     {
      "value": 2.2,
      "beyond_1sigma": true,
      "pnl": 312.0,
      "pct": 243.75
     }
    ]
   },
   {
    "name": "ATR +0.382× (prior close 499.10)",
    "tag": "ATR+0.382",
    "price": 501.4684,
    "pct_from_spot": 0.29,
    "role": "atr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 1.3119,
      "beyond_1sigma": false,
      "pnl": 134.38,
      "pct": 104.99
     },
     {
      "value": 1.2251,
      "beyond_1sigma": true,
      "pnl": 117.01,
      "pct": 91.41
     },
     {
      "value": 1.1216,
      "beyond_1sigma": true,
      "pnl": 96.33,
      "pct": 75.26
     },
     {
      "value": 1.0058,
      "beyond_1sigma": false,
      "pnl": 73.16,
      "pct": 57.16
     },
     {
      "value": 0.8711,
      "beyond_1sigma": false,
      "pnl": 46.22,
      "pct": 36.11
     },
     {
      "value": 0.7023,
      "beyond_1sigma": false,
      "pnl": 12.46,
      "pct": 9.74
     },
     {
      "value": 0.592,
      "beyond_1sigma": false,
      "pnl": -9.61,
      "pct": -7.51
     },
     {
      "value": 0.5244,
      "beyond_1sigma": false,
      "pnl": -23.13,
      "pct": -18.07
     },
     {
      "value": 0.4684,
      "beyond_1sigma": false,
      "pnl": -34.32,
      "pct": -26.81
     }
    ]
   },
   {
    "name": "ATR +0.236× (prior close 499.10)",
    "tag": "ATR+0.236",
    "price": 500.5632,
    "pct_from_spot": 0.11,
    "role": "atr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 0.846,
      "beyond_1sigma": false,
      "pnl": 41.2,
      "pct": 32.19
     },
     {
      "value": 0.7599,
      "beyond_1sigma": false,
      "pnl": 23.97,
      "pct": 18.73
     },
     {
      "value": 0.6573,
      "beyond_1sigma": false,
      "pnl": 3.45,
      "pct": 2.7
     },
     {
      "value": 0.5423,
      "beyond_1sigma": false,
      "pnl": -19.55,
      "pct": -15.27
     },
     {
      "value": 0.4084,
      "beyond_1sigma": false,
      "pnl": -46.33,
      "pct": -36.19
     },
     {
      "value": 0.24,
      "beyond_1sigma": false,
      "pnl": -80.0,
      "pct": -62.5
     },
     {
      "value": 0.1291,
      "beyond_1sigma": false,
      "pnl": -102.18,
      "pct": -79.83
     },
     {
      "value": 0.0601,
      "beyond_1sigma": false,
      "pnl": -115.98,
      "pct": -90.61
     },
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "pnl": -128.0,
      "pct": -100.0
     }
    ]
   },
   {
    "name": "Spot",
    "tag": "SPOT",
    "price": 500.0,
    "pct_from_spot": 0.0,
    "role": "spot",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 0.62,
      "beyond_1sigma": false,
      "pnl": -3.99,
      "pct": -3.12
     },
     {
      "value": 0.5398,
      "beyond_1sigma": false,
      "pnl": -20.05,
      "pct": -15.66
     },
     {
      "value": 0.4455,
      "beyond_1sigma": false,
      "pnl": -38.89,
      "pct": -30.39
     },
     {
      "value": 0.3424,
      "beyond_1sigma": false,
      "pnl": -59.53,
      "pct": -46.51
     },
     {
      "value": 0.2273,
      "beyond_1sigma": false,
      "pnl": -82.54,
      "pct": -64.48
     },
     {
      "value": 0.0974,
      "beyond_1sigma": false,
      "pnl": -108.52,
      "pct": -84.78
     },
     {
      "value": 0.0309,
      "beyond_1sigma": false,
      "pnl": -121.81,
      "pct": -95.17
     },
     {
      "value": 0.0058,
      "beyond_1sigma": false,
      "pnl": -126.85,
      "pct": -99.1
     },
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "pnl": -128.0,
      "pct": -100.0
     }
    ]
   },
   {
    "name": "10m 5/12 cloud bottom",
    "tag": "5/12▼",
    "price": 498.9,
    "pct_from_spot": -0.22,
    "role": "cloud",
    "is_target": false,
    "is_stop": false,
    "merged": [
     "5/12▲"
    ],
    "cells": [
     {
      "value": 0.3083,
      "beyond_1sigma": false,
      "pnl": -66.33,
      "pct": -51.82
     },
     {
      "value": 0.2481,
      "beyond_1sigma": true,
      "pnl": -78.39,
      "pct": -61.24
     },
     {
      "value": 0.1815,
      "beyond_1sigma": false,
      "pnl": -91.71,
      "pct": -71.64
     },
     {
      "value": 0.1155,
      "beyond_1sigma": false,
      "pnl": -104.9,
      "pct": -81.95
     },
     {
      "value": 0.0541,
      "beyond_1sigma": false,
      "pnl": -117.17,
      "pct": -91.54
     },
     {
      "value": 0.009,
      "beyond_1sigma": false,
      "pnl": -126.19,
      "pct": -98.59
     },
     {
      "value": 0.0005,
      "beyond_1sigma": false,
      "pnl": -127.9,
      "pct": -99.92
     },
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "pnl": -128.0,
      "pct": -100.0
     }
    ]
   },
   {
    "name": "Underfoot swing 1",
    "tag": "UF1",
    "price": 497.4,
    "pct_from_spot": -0.52,
    "role": "sr",
    "is_target": false,
    "is_stop": true,
    "merged": [
     "ATR−0.382",
     "ATR−0.236"
    ],
    "cells": [
     {
      "value": 0.096,
      "beyond_1sigma": false,
      "pnl": -108.81,
      "pct": -85.01
     },
     {
      "value": 0.0664,
      "beyond_1sigma": true,
      "pnl": -114.72,
      "pct": -89.62
     },
     {
      "value": 0.0384,
      "beyond_1sigma": true,
      "pnl": -120.32,
      "pct": -94.0
     },
     {
      "value": 0.0168,
      "beyond_1sigma": true,
      "pnl": -124.65,
      "pct": -97.38
     },
     {
      "value": 0.0038,
      "beyond_1sigma": true,
      "pnl": -127.24,
      "pct": -99.4
     },
     {
      "value": 0.0001,
      "beyond_1sigma": true,
      "pnl": -127.98,
      "pct": -99.99
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     }
    ]
   },
   {
    "name": "ATR −0.618× (prior close 499.10)",
    "tag": "ATR−0.618",
    "price": 495.2684,
    "pct_from_spot": -0.95,
    "role": "atr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 0.0114,
      "beyond_1sigma": false,
      "pnl": -125.72,
      "pct": -98.22
     },
     {
      "value": 0.0058,
      "beyond_1sigma": true,
      "pnl": -126.84,
      "pct": -99.1
     },
     {
      "value": 0.002,
      "beyond_1sigma": true,
      "pnl": -127.59,
      "pct": -99.68
     },
     {
      "value": 0.0004,
      "beyond_1sigma": true,
      "pnl": -127.92,
      "pct": -99.94
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     }
    ]
   },
   {
    "name": "Underfoot swing 2",
    "tag": "UF2",
    "price": 494.1,
    "pct_from_spot": -1.18,
    "role": "sr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 0.0027,
      "beyond_1sigma": false,
      "pnl": -127.45,
      "pct": -99.57
     },
     {
      "value": 0.0011,
      "beyond_1sigma": true,
      "pnl": -127.78,
      "pct": -99.83
     },
     {
      "value": 0.0003,
      "beyond_1sigma": true,
      "pnl": -127.94,
      "pct": -99.96
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -127.99,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     }
    ]
   },
   {
    "name": "ATR −1× (prior close 499.10)",
    "tag": "ATR−1",
    "price": 492.9,
    "pct_from_spot": -1.42,
    "role": "atr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 0.0005,
      "beyond_1sigma": false,
      "pnl": -127.9,
      "pct": -99.92
     },
     {
      "value": 0.0002,
      "beyond_1sigma": true,
      "pnl": -127.97,
      "pct": -99.97
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -127.99,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     }
    ]
   },
   {
    "name": "Round below",
    "tag": "RND↓",
    "price": 490.0,
    "pct_from_spot": -2.0,
    "role": "sr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -128.0,
      "pct": -100.0
     }
    ]
   }
  ],
  "target": {
   "price": 503.2,
   "name": "Overhead swing 1",
   "tag": "OH1",
   "source": "structural"
  },
  "stop": {
   "price": 497.4,
   "name": "Underfoot swing 1",
   "tag": "UF1",
   "source": "structural_beyond_cloud",
   "premium_ref": null,
   "underlying_per_column": [
    497.4,
    497.4,
    497.4,
    497.4,
    497.4,
    497.4,
    497.4,
    497.4,
    497.4
   ]
  },
  "summary": [
   {
    "label": "Now",
    "breakeven": 500.0551,
    "breakeven_pct": 0.01,
    "reward": 1.8948,
    "risk": 0.544,
    "reward_dollars": 378.97,
    "risk_dollars": 108.81,
    "rr": 3.483,
    "clears_gate": true,
    "expected_move_1sigma": 0.0,
    "touch_prob_target": null,
    "touch_prob_stop": null,
    "stop_underlying": 497.4,
    "low_confidence": false
   },
   {
    "label": "11:00",
    "breakeven": 500.2638,
    "breakeven_pct": 0.05,
    "reward": 1.8319,
    "risk": 0.5736,
    "reward_dollars": 366.37,
    "risk_dollars": 114.72,
    "rr": 3.194,
    "clears_gate": true,
    "expected_move_1sigma": 1.0028,
    "touch_prob_target": 0.0015,
    "touch_prob_stop": 0.0093,
    "stop_underlying": 497.4,
    "low_confidence": false
   },
   {
    "label": "12:00",
    "breakeven": 500.5321,
    "breakeven_pct": 0.11,
    "reward": 1.7623,
    "risk": 0.6016,
    "reward_dollars": 352.46,
    "risk_dollars": 120.32,
    "rr": 2.929,
    "clears_gate": true,
    "expected_move_1sigma": 1.45,
    "touch_prob_target": 0.0278,
    "touch_prob_stop": 0.0722,
    "stop_underlying": 497.4,
    "low_confidence": false
   },
   {
    "label": "13:00",
    "breakeven": 500.7856,
    "breakeven_pct": 0.16,
    "reward": 1.6932,
    "risk": 0.6232,
    "reward_dollars": 338.64,
    "risk_dollars": 124.65,
    "rr": 2.717,
    "clears_gate": true,
    "expected_move_1sigma": 1.7887,
    "touch_prob_target": 0.0745,
    "touch_prob_stop": 0.145,
    "stop_underlying": 497.4,
    "low_confidence": false
   },
   {
    "label": "14:00",
    "breakeven": 501.0688,
    "breakeven_pct": 0.21,
    "reward": 1.6285,
    "risk": 0.6362,
    "reward_dollars": 325.7,
    "risk_dollars": 127.24,
    "rr": 2.56,
    "clears_gate": true,
    "expected_move_1sigma": 2.0728,
    "touch_prob_target": 0.1238,
    "touch_prob_stop": 0.2085,
    "stop_underlying": 497.4,
    "low_confidence": false
   },
   {
    "label": "15:00",
    "breakeven": 501.3669,
    "breakeven_pct": 0.27,
    "reward": 1.579,
    "risk": 0.6399,
    "reward_dollars": 315.79,
    "risk_dollars": 127.98,
    "rr": 2.467,
    "clears_gate": true,
    "expected_move_1sigma": 2.3223,
    "touch_prob_target": 0.1696,
    "touch_prob_stop": 0.2617,
    "stop_underlying": 497.4,
    "low_confidence": true
   },
   {
    "label": "15:30",
    "breakeven": 501.5309,
    "breakeven_pct": 0.31,
    "reward": 1.5664,
    "risk": 0.64,
    "reward_dollars": 313.29,
    "risk_dollars": 128.0,
    "rr": 2.448,
    "clears_gate": true,
    "expected_move_1sigma": 2.4376,
    "touch_prob_target": 0.1907,
    "touch_prob_stop": 0.2849,
    "stop_underlying": 497.4,
    "low_confidence": true
   },
   {
    "label": "15:45",
    "breakeven": 501.6055,
    "breakeven_pct": 0.32,
    "reward": 1.5631,
    "risk": 0.64,
    "reward_dollars": 312.61,
    "risk_dollars": 128.0,
    "rr": 2.442,
    "clears_gate": true,
    "expected_move_1sigma": 2.4932,
    "touch_prob_target": 0.2008,
    "touch_prob_stop": 0.2958,
    "stop_underlying": 497.4,
    "low_confidence": true
   },
   {
    "label": "Expiry",
    "breakeven": 501.6353,
    "breakeven_pct": 0.33,
    "reward": 1.56,
    "risk": 0.64,
    "reward_dollars": 312.0,
    "risk_dollars": 128.0,
    "rr": 2.437,
    "clears_gate": true,
    "expected_move_1sigma": 2.5476,
    "touch_prob_target": 0.2105,
    "touch_prob_stop": 0.3062,
    "stop_underlying": 497.4,
    "low_confidence": true
   }
  ],
  "stale_at": null,
  "legs": null,
  "warnings": [
   "low_confidence: 0DTE columns inside the last trading hour"
  ]
 },
 "signal_3dte_put": {
  "available": true,
  "mode": "signal",
  "contract": {
   "ticker": "SPY",
   "strike": 498.0,
   "expiry": "2026-11-20",
   "right": "put",
   "option_symbol": "SPY261120P00498000"
  },
  "position_id": null,
  "qty": 2,
  "now": "2026-11-17T10:30:00-05:00",
  "spot": 500.0,
  "spot_source": "engine_live",
  "basis": {
   "type": "ask",
   "price": 2.78
  },
  "cost": null,
  "mid": 2.76,
  "sigma_trading": 0.154617,
  "iv_display": 0.203083,
  "sigma_source": "back_solved_mid",
  "daily_atr": 6.2,
  "prev_close": 499.1,
  "atr_anchor_date": "2026-11-16",
  "columns": [
   {
    "label": "Now",
    "ts": "2026-11-17T10:30:00-05:00",
    "t_years": 0.015262515262515262,
    "is_expiry": false,
    "low_confidence": false,
    "expected_move_1sigma": 0.0
   },
   {
    "label": "11:30",
    "ts": "2026-11-17T11:30:00-05:00",
    "t_years": 0.014652014652014652,
    "is_expiry": false,
    "low_confidence": false,
    "expected_move_1sigma": 1.9102
   },
   {
    "label": "Close",
    "ts": "2026-11-17T16:00:00-05:00",
    "t_years": 0.011904761904761904,
    "is_expiry": false,
    "low_confidence": false,
    "expected_move_1sigma": 4.4797
   },
   {
    "label": "Wed close",
    "ts": "2026-11-18T16:00:00-05:00",
    "t_years": 0.007936507936507936,
    "is_expiry": false,
    "low_confidence": false,
    "expected_move_1sigma": 6.617
   },
   {
    "label": "Thu close",
    "ts": "2026-11-19T16:00:00-05:00",
    "t_years": 0.003968253968253968,
    "is_expiry": false,
    "low_confidence": false,
    "expected_move_1sigma": 8.2159
   },
   {
    "label": "Expiry",
    "ts": "2026-11-20T16:00:00-05:00",
    "t_years": 0.0,
    "is_expiry": true,
    "low_confidence": false,
    "expected_move_1sigma": 9.5508
   }
  ],
  "rows": [
   {
    "name": "Round below",
    "tag": "RND↓",
    "price": 490.0,
    "pct_from_spot": -2.0,
    "role": "sr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 8.7986,
      "beyond_1sigma": false,
      "pnl": 1203.72,
      "pct": 216.5
     },
     {
      "value": 8.7542,
      "beyond_1sigma": true,
      "pnl": 1194.84,
      "pct": 214.9
     },
     {
      "value": 8.5521,
      "beyond_1sigma": true,
      "pnl": 1154.42,
      "pct": 207.63
     },
     {
      "value": 8.2622,
      "beyond_1sigma": true,
      "pnl": 1096.43,
      "pct": 197.2
     },
     {
      "value": 8.0211,
      "beyond_1sigma": true,
      "pnl": 1048.22,
      "pct": 188.53
     },
     {
      "value": 8.0,
      "beyond_1sigma": true,
      "pnl": 1044.0,
      "pct": 187.77
     }
    ]
   },
   {
    "name": "ATR −1× (prior close 499.10)",
    "tag": "ATR−1",
    "price": 492.9,
    "pct_from_spot": -1.42,
    "role": "atr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 6.6472,
      "beyond_1sigma": false,
      "pnl": 773.44,
      "pct": 139.11
     },
     {
      "value": 6.5888,
      "beyond_1sigma": true,
      "pnl": 761.77,
      "pct": 137.01
     },
     {
      "value": 6.3142,
      "beyond_1sigma": true,
      "pnl": 706.83,
      "pct": 127.13
     },
     {
      "value": 5.8774,
      "beyond_1sigma": true,
      "pnl": 619.48,
      "pct": 111.42
     },
     {
      "value": 5.3929,
      "beyond_1sigma": false,
      "pnl": 522.57,
      "pct": 93.99
     },
     {
      "value": 5.1,
      "beyond_1sigma": false,
      "pnl": 464.0,
      "pct": 83.45
     }
    ]
   },
   {
    "name": "Underfoot swing 2",
    "tag": "UF2",
    "price": 494.1,
    "pct_from_spot": -1.18,
    "role": "sr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 5.846,
      "beyond_1sigma": false,
      "pnl": 613.21,
      "pct": 110.29
     },
     {
      "value": 5.783,
      "beyond_1sigma": true,
      "pnl": 600.61,
      "pct": 108.02
     },
     {
      "value": 5.484,
      "beyond_1sigma": true,
      "pnl": 540.8,
      "pct": 97.27
     },
     {
      "value": 4.9953,
      "beyond_1sigma": false,
      "pnl": 443.06,
      "pct": 79.69
     },
     {
      "value": 4.4111,
      "beyond_1sigma": false,
      "pnl": 326.21,
      "pct": 58.67
     },
     {
      "value": 3.9,
      "beyond_1sigma": false,
      "pnl": 224.0,
      "pct": 40.29
     }
    ]
   },
   {
    "name": "ATR −0.618× (prior close 499.10)",
    "tag": "ATR−0.618",
    "price": 495.2684,
    "pct_from_spot": -0.95,
    "role": "atr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 5.1205,
      "beyond_1sigma": false,
      "pnl": 468.1,
      "pct": 84.19
     },
     {
      "value": 5.0539,
      "beyond_1sigma": true,
      "pnl": 454.79,
      "pct": 81.8
     },
     {
      "value": 4.736,
      "beyond_1sigma": true,
      "pnl": 391.19,
      "pct": 70.36
     },
     {
      "value": 4.2063,
      "beyond_1sigma": false,
      "pnl": 285.26,
      "pct": 51.31
     },
     {
      "value": 3.539,
      "beyond_1sigma": false,
      "pnl": 151.8,
      "pct": 27.3
     },
     {
      "value": 2.7316,
      "beyond_1sigma": false,
      "pnl": -9.68,
      "pct": -1.74
     }
    ]
   },
   {
    "name": "Underfoot swing 1",
    "tag": "UF1",
    "price": 497.4,
    "pct_from_spot": -0.52,
    "role": "sr",
    "is_target": true,
    "is_stop": false,
    "merged": [
     "ATR−0.382",
     "ATR−0.236"
    ],
    "cells": [
     {
      "value": 3.9414,
      "beyond_1sigma": false,
      "pnl": 232.27,
      "pct": 41.78
     },
     {
      "value": 3.8711,
      "beyond_1sigma": true,
      "pnl": 218.22,
      "pct": 39.25
     },
     {
      "value": 3.5334,
      "beyond_1sigma": false,
      "pnl": 150.68,
      "pct": 27.1
     },
     {
      "value": 2.9611,
      "beyond_1sigma": false,
      "pnl": 36.23,
      "pct": 6.52
     },
     {
      "value": 2.2054,
      "beyond_1sigma": false,
      "pnl": -114.92,
      "pct": -20.67
     },
     {
      "value": 0.6,
      "beyond_1sigma": false,
      "pnl": -436.0,
      "pct": -78.42
     }
    ]
   },
   {
    "name": "Spot",
    "tag": "SPOT",
    "price": 500.0,
    "pct_from_spot": 0.0,
    "role": "spot",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 2.76,
      "beyond_1sigma": false,
      "pnl": -4.0,
      "pct": -0.72
     },
     {
      "value": 2.6904,
      "beyond_1sigma": false,
      "pnl": -17.92,
      "pct": -3.22
     },
     {
      "value": 2.3569,
      "beyond_1sigma": false,
      "pnl": -84.62,
      "pct": -15.22
     },
     {
      "value": 1.7967,
      "beyond_1sigma": false,
      "pnl": -196.66,
      "pct": -35.37
     },
     {
      "value": 1.074,
      "beyond_1sigma": false,
      "pnl": -341.19,
      "pct": -61.37
     },
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "pnl": -556.0,
      "pct": -100.0
     }
    ]
   },
   {
    "name": "10m 5/12 cloud bottom",
    "tag": "5/12▼",
    "price": 500.4,
    "pct_from_spot": 0.08,
    "role": "cloud",
    "is_target": false,
    "is_stop": false,
    "merged": [
     "ATR+0.236"
    ],
    "cells": [
     {
      "value": 2.6029,
      "beyond_1sigma": false,
      "pnl": -35.42,
      "pct": -6.37
     },
     {
      "value": 2.5339,
      "beyond_1sigma": false,
      "pnl": -49.22,
      "pct": -8.85
     },
     {
      "value": 2.2038,
      "beyond_1sigma": false,
      "pnl": -115.25,
      "pct": -20.73
     },
     {
      "value": 1.6514,
      "beyond_1sigma": false,
      "pnl": -225.72,
      "pct": -40.6
     },
     {
      "value": 0.9469,
      "beyond_1sigma": false,
      "pnl": -366.63,
      "pct": -65.94
     },
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "pnl": -556.0,
      "pct": -100.0
     }
    ]
   },
   {
    "name": "10m 5/12 cloud top",
    "tag": "5/12▲",
    "price": 501.2,
    "pct_from_spot": 0.24,
    "role": "cloud",
    "is_target": false,
    "is_stop": false,
    "merged": [
     "ATR+0.382"
    ],
    "cells": [
     {
      "value": 2.3078,
      "beyond_1sigma": false,
      "pnl": -94.43,
      "pct": -16.98
     },
     {
      "value": 2.2404,
      "beyond_1sigma": false,
      "pnl": -107.92,
      "pct": -19.41
     },
     {
      "value": 1.9189,
      "beyond_1sigma": false,
      "pnl": -172.23,
      "pct": -30.98
     },
     {
      "value": 1.3865,
      "beyond_1sigma": false,
      "pnl": -278.7,
      "pct": -50.13
     },
     {
      "value": 0.7264,
      "beyond_1sigma": false,
      "pnl": -410.71,
      "pct": -73.87
     },
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "pnl": -556.0,
      "pct": -100.0
     }
    ]
   },
   {
    "name": "Overhead swing 1",
    "tag": "OH1",
    "price": 503.2,
    "pct_from_spot": 0.64,
    "role": "sr",
    "is_target": false,
    "is_stop": true,
    "merged": [
     "ATR+0.618"
    ],
    "cells": [
     {
      "value": 1.6768,
      "beyond_1sigma": false,
      "pnl": -220.64,
      "pct": -39.68
     },
     {
      "value": 1.6152,
      "beyond_1sigma": true,
      "pnl": -232.96,
      "pct": -41.9
     },
     {
      "value": 1.325,
      "beyond_1sigma": false,
      "pnl": -291.0,
      "pct": -52.34
     },
     {
      "value": 0.8626,
      "beyond_1sigma": false,
      "pnl": -383.48,
      "pct": -68.97
     },
     {
      "value": 0.3461,
      "beyond_1sigma": false,
      "pnl": -486.78,
      "pct": -87.55
     },
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "pnl": -556.0,
      "pct": -100.0
     }
    ]
   },
   {
    "name": "ATR +1× (prior close 499.10)",
    "tag": "ATR+1",
    "price": 505.3,
    "pct_from_spot": 1.06,
    "role": "atr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 1.1641,
      "beyond_1sigma": false,
      "pnl": -323.18,
      "pct": -58.13
     },
     {
      "value": 1.1107,
      "beyond_1sigma": true,
      "pnl": -333.86,
      "pct": -60.05
     },
     {
      "value": 0.8641,
      "beyond_1sigma": true,
      "pnl": -383.19,
      "pct": -68.92
     },
     {
      "value": 0.4936,
      "beyond_1sigma": false,
      "pnl": -457.28,
      "pct": -82.25
     },
     {
      "value": 0.1398,
      "beyond_1sigma": false,
      "pnl": -528.03,
      "pct": -94.97
     },
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "pnl": -556.0,
      "pct": -100.0
     }
    ]
   },
   {
    "name": "Overhead swing 2",
    "tag": "OH2",
    "price": 506.5,
    "pct_from_spot": 1.3,
    "role": "sr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 0.9319,
      "beyond_1sigma": false,
      "pnl": -369.63,
      "pct": -66.48
     },
     {
      "value": 0.8837,
      "beyond_1sigma": true,
      "pnl": -379.26,
      "pct": -68.21
     },
     {
      "value": 0.6645,
      "beyond_1sigma": true,
      "pnl": -423.1,
      "pct": -76.1
     },
     {
      "value": 0.3486,
      "beyond_1sigma": false,
      "pnl": -486.27,
      "pct": -87.46
     },
     {
      "value": 0.0783,
      "beyond_1sigma": false,
      "pnl": -540.33,
      "pct": -97.18
     },
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "pnl": -556.0,
      "pct": -100.0
     }
    ]
   },
   {
    "name": "Round above",
    "tag": "RND↑",
    "price": 510.0,
    "pct_from_spot": 2.0,
    "role": "sr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 0.4586,
      "beyond_1sigma": false,
      "pnl": -464.29,
      "pct": -83.51
     },
     {
      "value": 0.4261,
      "beyond_1sigma": true,
      "pnl": -470.79,
      "pct": -84.67
     },
     {
      "value": 0.2854,
      "beyond_1sigma": true,
      "pnl": -498.91,
      "pct": -89.73
     },
     {
      "value": 0.1118,
      "beyond_1sigma": true,
      "pnl": -533.64,
      "pct": -95.98
     },
     {
      "value": 0.0111,
      "beyond_1sigma": true,
      "pnl": -553.78,
      "pct": -99.6
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "pnl": -556.0,
      "pct": -100.0
     }
    ]
   }
  ],
  "target": {
   "price": 497.4,
   "name": "Underfoot swing 1",
   "tag": "UF1",
   "source": "structural"
  },
  "stop": {
   "price": 503.2,
   "name": "Overhead swing 1",
   "tag": "OH1",
   "source": "structural_beyond_cloud",
   "premium_ref": null,
   "underlying_per_column": [
    503.2,
    503.2,
    503.2,
    503.2,
    503.2,
    503.2
   ]
  },
  "summary": [
   {
    "label": "Now",
    "breakeven": 499.9503,
    "breakeven_pct": -0.01,
    "reward": 1.1614,
    "risk": 1.1032,
    "reward_dollars": 232.27,
    "risk_dollars": 220.64,
    "rr": 1.053,
    "clears_gate": false,
    "expected_move_1sigma": 0.0,
    "touch_prob_target": null,
    "touch_prob_stop": null,
    "stop_underlying": 503.2,
    "low_confidence": false
   },
   {
    "label": "11:30",
    "breakeven": 499.7873,
    "breakeven_pct": -0.04,
    "reward": 1.0911,
    "risk": 1.1648,
    "reward_dollars": 218.22,
    "risk_dollars": 232.96,
    "rr": 0.937,
    "clears_gate": false,
    "expected_move_1sigma": 1.9102,
    "touch_prob_target": 0.1724,
    "touch_prob_stop": 0.0949,
    "stop_underlying": 503.2,
    "low_confidence": false
   },
   {
    "label": "Close",
    "breakeven": 498.9871,
    "breakeven_pct": -0.2,
    "reward": 0.7534,
    "risk": 1.455,
    "reward_dollars": 150.68,
    "risk_dollars": 291.0,
    "rr": 0.518,
    "clears_gate": false,
    "expected_move_1sigma": 4.4797,
    "touch_prob_target": 0.5606,
    "touch_prob_stop": 0.4764,
    "stop_underlying": 503.2,
    "low_confidence": false
   },
   {
    "label": "Wed close",
    "breakeven": 497.7572,
    "breakeven_pct": -0.45,
    "reward": 0.1811,
    "risk": 1.9174,
    "reward_dollars": 36.23,
    "risk_dollars": 383.48,
    "rr": 0.094,
    "clears_gate": false,
    "expected_move_1sigma": 6.617,
    "touch_prob_target": 0.6936,
    "touch_prob_stop": 0.6298,
    "stop_underlying": 503.2,
    "low_confidence": false
   },
   {
    "label": "Thu close",
    "breakeven": 496.4088,
    "breakeven_pct": -0.72,
    "reward": -0.5746,
    "risk": 2.4339,
    "reward_dollars": -114.92,
    "risk_dollars": 486.78,
    "rr": null,
    "clears_gate": false,
    "expected_move_1sigma": 8.2159,
    "touch_prob_target": 0.751,
    "touch_prob_stop": 0.6978,
    "stop_underlying": 503.2,
    "low_confidence": false
   },
   {
    "label": "Expiry",
    "breakeven": 495.2234,
    "breakeven_pct": -0.96,
    "reward": -2.18,
    "risk": 2.78,
    "reward_dollars": -436.0,
    "risk_dollars": 556.0,
    "rr": null,
    "clears_gate": false,
    "expected_move_1sigma": 9.5508,
    "touch_prob_target": 0.7849,
    "touch_prob_stop": 0.7384,
    "stop_underlying": 503.2,
    "low_confidence": false
   }
  ],
  "stale_at": {
   "index": 0,
   "label": "Now",
   "ts": "2026-11-17T10:30:00-05:00"
  },
  "legs": null,
  "warnings": []
 },
 "position_legs": {
  "available": true,
  "mode": "position",
  "contract": {
   "ticker": "SPY",
   "strike": 502.0,
   "expiry": "2026-11-20",
   "right": "call",
   "option_symbol": "SPY261120C00502000"
  },
  "position_id": "mock-pos-legs",
  "qty": 3,
  "now": "2026-11-18T11:15:00-05:00",
  "spot": 500.0,
  "spot_source": "position_live",
  "basis": {
   "type": "mark",
   "price": 2.25
  },
  "cost": 1.84,
  "mid": 2.25,
  "sigma_trading": 0.147055,
  "iv_display": 0.197271,
  "sigma_source": "back_solved_mid",
  "daily_atr": 6.2,
  "prev_close": 499.1,
  "atr_anchor_date": "2026-11-16",
  "columns": [
   {
    "label": "Now",
    "ts": "2026-11-18T11:15:00-05:00",
    "t_years": 0.010836385836385836,
    "is_expiry": false,
    "low_confidence": false,
    "expected_move_1sigma": 0.0
   },
   {
    "label": "12:15",
    "ts": "2026-11-18T12:15:00-05:00",
    "t_years": 0.010225885225885226,
    "is_expiry": false,
    "low_confidence": false,
    "expected_move_1sigma": 1.8167
   },
   {
    "label": "Close",
    "ts": "2026-11-18T16:00:00-05:00",
    "t_years": 0.007936507936507936,
    "is_expiry": false,
    "low_confidence": false,
    "expected_move_1sigma": 3.9595
   },
   {
    "label": "Thu close",
    "ts": "2026-11-19T16:00:00-05:00",
    "t_years": 0.003968253968253968,
    "is_expiry": false,
    "low_confidence": false,
    "expected_move_1sigma": 6.0935
   },
   {
    "label": "Expiry",
    "ts": "2026-11-20T16:00:00-05:00",
    "t_years": 0.0,
    "is_expiry": true,
    "low_confidence": false,
    "expected_move_1sigma": 7.6541
   }
  ],
  "rows": [
   {
    "name": "Round above",
    "tag": "RND↑",
    "price": 510.0,
    "pct_from_spot": 2.0,
    "role": "sr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 8.791,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 2085.31,
       "pct": 377.77
      },
      "vs_mark": {
       "pnl": 1962.31,
       "pct": 290.71
      }
     },
     {
      "value": 8.731,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 2067.31,
       "pct": 374.51
      },
      "vs_mark": {
       "pnl": 1944.31,
       "pct": 288.05
      }
     },
     {
      "value": 8.5081,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 2000.42,
       "pct": 362.4
      },
      "vs_mark": {
       "pnl": 1877.42,
       "pct": 278.14
      }
     },
     {
      "value": 8.1605,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 1896.16,
       "pct": 343.51
      },
      "vs_mark": {
       "pnl": 1773.16,
       "pct": 262.69
      }
     },
     {
      "value": 8.0,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 1848.0,
       "pct": 334.78
      },
      "vs_mark": {
       "pnl": 1725.0,
       "pct": 255.56
      }
     }
    ]
   },
   {
    "name": "Overhead swing 2",
    "tag": "OH2",
    "price": 506.5,
    "pct_from_spot": 1.3,
    "role": "sr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 5.9955,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 1246.66,
       "pct": 225.84
      },
      "vs_mark": {
       "pnl": 1123.66,
       "pct": 166.47
      }
     },
     {
      "value": 5.914,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 1222.19,
       "pct": 221.41
      },
      "vs_mark": {
       "pnl": 1099.19,
       "pct": 162.84
      }
     },
     {
      "value": 5.5944,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 1126.32,
       "pct": 204.04
      },
      "vs_mark": {
       "pnl": 1003.32,
       "pct": 148.64
      }
     },
     {
      "value": 4.9835,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 943.05,
       "pct": 170.84
      },
      "vs_mark": {
       "pnl": 820.05,
       "pct": 121.49
      }
     },
     {
      "value": 4.5,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 798.0,
       "pct": 144.57
      },
      "vs_mark": {
       "pnl": 675.0,
       "pct": 100.0
      }
     }
    ]
   },
   {
    "name": "ATR +1× (prior close 499.10)",
    "tag": "ATR+1",
    "price": 505.3,
    "pct_from_spot": 1.06,
    "role": "atr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 5.1486,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 992.59,
       "pct": 179.82
      },
      "vs_mark": {
       "pnl": 869.59,
       "pct": 128.83
      }
     },
     {
      "value": 5.0614,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 966.42,
       "pct": 175.08
      },
      "vs_mark": {
       "pnl": 843.42,
       "pct": 124.95
      }
     },
     {
      "value": 4.7153,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 862.59,
       "pct": 156.27
      },
      "vs_mark": {
       "pnl": 739.59,
       "pct": 109.57
      }
     },
     {
      "value": 4.0191,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 653.72,
       "pct": 118.43
      },
      "vs_mark": {
       "pnl": 530.72,
       "pct": 78.63
      }
     },
     {
      "value": 3.3,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 438.0,
       "pct": 79.35
      },
      "vs_mark": {
       "pnl": 315.0,
       "pct": 46.67
      }
     }
    ]
   },
   {
    "name": "Overhead swing 1",
    "tag": "OH1",
    "price": 503.2,
    "pct_from_spot": 0.64,
    "role": "sr",
    "is_target": true,
    "is_stop": false,
    "merged": [
     "ATR+0.618"
    ],
    "cells": [
     {
      "value": 3.8295,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 596.84,
       "pct": 108.12
      },
      "vs_mark": {
       "pnl": 473.84,
       "pct": 70.2
      }
     },
     {
      "value": 3.7363,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 568.88,
       "pct": 103.06
      },
      "vs_mark": {
       "pnl": 445.88,
       "pct": 66.06
      }
     },
     {
      "value": 3.3618,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 456.55,
       "pct": 82.71
      },
      "vs_mark": {
       "pnl": 333.55,
       "pct": 49.41
      }
     },
     {
      "value": 2.5668,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 218.05,
       "pct": 39.5
      },
      "vs_mark": {
       "pnl": 95.05,
       "pct": 14.08
      }
     },
     {
      "value": 1.2,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -192.0,
       "pct": -34.78
      },
      "vs_mark": {
       "pnl": -315.0,
       "pct": -46.67
      }
     }
    ]
   },
   {
    "name": "ATR +0.382× (prior close 499.10)",
    "tag": "ATR+0.382",
    "price": 501.4684,
    "pct_from_spot": 0.29,
    "role": "atr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 2.909,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 320.69,
       "pct": 58.1
      },
      "vs_mark": {
       "pnl": 197.69,
       "pct": 29.29
      }
     },
     {
      "value": 2.8156,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 292.69,
       "pct": 53.02
      },
      "vs_mark": {
       "pnl": 169.69,
       "pct": 25.14
      }
     },
     {
      "value": 2.4399,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 179.98,
       "pct": 32.6
      },
      "vs_mark": {
       "pnl": 56.98,
       "pct": 8.44
      }
     },
     {
      "value": 1.6369,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -60.94,
       "pct": -11.04
      },
      "vs_mark": {
       "pnl": -183.94,
       "pct": -27.25
      }
     },
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -552.0,
       "pct": -100.0
      },
      "vs_mark": {
       "pnl": -675.0,
       "pct": -100.0
      }
     }
    ]
   },
   {
    "name": "ATR +0.236× (prior close 499.10)",
    "tag": "ATR+0.236",
    "price": 500.5632,
    "pct_from_spot": 0.11,
    "role": "atr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 2.4896,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 194.88,
       "pct": 35.3
      },
      "vs_mark": {
       "pnl": 71.88,
       "pct": 10.65
      }
     },
     {
      "value": 2.398,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 167.4,
       "pct": 30.33
      },
      "vs_mark": {
       "pnl": 44.4,
       "pct": 6.58
      }
     },
     {
      "value": 2.0302,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 57.05,
       "pct": 10.34
      },
      "vs_mark": {
       "pnl": -65.95,
       "pct": -9.77
      }
     },
     {
      "value": 1.2524,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -176.28,
       "pct": -31.93
      },
      "vs_mark": {
       "pnl": -299.28,
       "pct": -44.34
      }
     },
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -552.0,
       "pct": -100.0
      },
      "vs_mark": {
       "pnl": -675.0,
       "pct": -100.0
      }
     }
    ]
   },
   {
    "name": "Spot",
    "tag": "SPOT",
    "price": 500.0,
    "pct_from_spot": 0.0,
    "role": "spot",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 2.25,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 123.0,
       "pct": 22.28
      },
      "vs_mark": {
       "pnl": 0.0,
       "pct": 0.0
      }
     },
     {
      "value": 2.1601,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 96.02,
       "pct": 17.39
      },
      "vs_mark": {
       "pnl": -26.98,
       "pct": -4.0
      }
     },
     {
      "value": 1.8,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -12.0,
       "pct": -2.17
      },
      "vs_mark": {
       "pnl": -135.0,
       "pct": -20.0
      }
     },
     {
      "value": 1.0475,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -237.75,
       "pct": -43.07
      },
      "vs_mark": {
       "pnl": -360.75,
       "pct": -53.45
      }
     },
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -552.0,
       "pct": -100.0
      },
      "vs_mark": {
       "pnl": -675.0,
       "pct": -100.0
      }
     }
    ]
   },
   {
    "name": "10m 5/12 cloud top",
    "tag": "5/12▲",
    "price": 499.7,
    "pct_from_spot": -0.06,
    "role": "cloud",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 2.129,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 86.69,
       "pct": 15.7
      },
      "vs_mark": {
       "pnl": -36.31,
       "pct": -5.38
      }
     },
     {
      "value": 2.0401,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 60.03,
       "pct": 10.87
      },
      "vs_mark": {
       "pnl": -62.97,
       "pct": -9.33
      }
     },
     {
      "value": 1.685,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -46.5,
       "pct": -8.42
      },
      "vs_mark": {
       "pnl": -169.5,
       "pct": -25.11
      }
     },
     {
      "value": 0.9487,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -267.4,
       "pct": -48.44
      },
      "vs_mark": {
       "pnl": -390.4,
       "pct": -57.84
      }
     },
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -552.0,
       "pct": -100.0
      },
      "vs_mark": {
       "pnl": -675.0,
       "pct": -100.0
      }
     }
    ]
   },
   {
    "name": "10m 5/12 cloud bottom",
    "tag": "5/12▼",
    "price": 498.8,
    "pct_from_spot": -0.24,
    "role": "cloud",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 1.7928,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -14.15,
       "pct": -2.56
      },
      "vs_mark": {
       "pnl": -137.15,
       "pct": -20.32
      }
     },
     {
      "value": 1.7079,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -39.63,
       "pct": -7.18
      },
      "vs_mark": {
       "pnl": -162.63,
       "pct": -24.09
      }
     },
     {
      "value": 1.371,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -140.71,
       "pct": -25.49
      },
      "vs_mark": {
       "pnl": -263.71,
       "pct": -39.07
      }
     },
     {
      "value": 0.6929,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -344.14,
       "pct": -62.35
      },
      "vs_mark": {
       "pnl": -467.14,
       "pct": -69.21
      }
     },
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -552.0,
       "pct": -100.0
      },
      "vs_mark": {
       "pnl": -675.0,
       "pct": -100.0
      }
     }
    ]
   },
   {
    "name": "Underfoot swing 1",
    "tag": "UF1",
    "price": 497.4,
    "pct_from_spot": -0.52,
    "role": "sr",
    "is_target": false,
    "is_stop": true,
    "merged": [
     "ATR−0.382",
     "ATR−0.236"
    ],
    "cells": [
     {
      "value": 1.3474,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -147.77,
       "pct": -26.77
      },
      "vs_mark": {
       "pnl": -270.77,
       "pct": -40.11
      }
     },
     {
      "value": 1.2704,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": -170.87,
       "pct": -30.95
      },
      "vs_mark": {
       "pnl": -293.87,
       "pct": -43.54
      }
     },
     {
      "value": 0.9698,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -261.06,
       "pct": -47.29
      },
      "vs_mark": {
       "pnl": -384.06,
       "pct": -56.9
      }
     },
     {
      "value": 0.4031,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -431.06,
       "pct": -78.09
      },
      "vs_mark": {
       "pnl": -554.06,
       "pct": -82.08
      }
     },
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -552.0,
       "pct": -100.0
      },
      "vs_mark": {
       "pnl": -675.0,
       "pct": -100.0
      }
     }
    ]
   },
   {
    "name": "ATR −0.618× (prior close 499.10)",
    "tag": "ATR−0.618",
    "price": 495.2684,
    "pct_from_spot": -0.95,
    "role": "atr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 0.8338,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -301.85,
       "pct": -54.68
      },
      "vs_mark": {
       "pnl": -424.85,
       "pct": -62.94
      }
     },
     {
      "value": 0.7717,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": -320.48,
       "pct": -58.06
      },
      "vs_mark": {
       "pnl": -443.48,
       "pct": -65.7
      }
     },
     {
      "value": 0.5377,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": -390.69,
       "pct": -70.78
      },
      "vs_mark": {
       "pnl": -513.69,
       "pct": -76.1
      }
     },
     {
      "value": 0.1549,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -505.53,
       "pct": -91.58
      },
      "vs_mark": {
       "pnl": -628.53,
       "pct": -93.12
      }
     },
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -552.0,
       "pct": -100.0
      },
      "vs_mark": {
       "pnl": -675.0,
       "pct": -100.0
      }
     }
    ]
   },
   {
    "name": "Underfoot swing 2",
    "tag": "UF2",
    "price": 494.1,
    "pct_from_spot": -1.18,
    "role": "sr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 0.6256,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -364.33,
       "pct": -66.0
      },
      "vs_mark": {
       "pnl": -487.33,
       "pct": -72.2
      }
     },
     {
      "value": 0.5722,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": -380.33,
       "pct": -68.9
      },
      "vs_mark": {
       "pnl": -503.33,
       "pct": -74.57
      }
     },
     {
      "value": 0.3762,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": -439.14,
       "pct": -79.55
      },
      "vs_mark": {
       "pnl": -562.14,
       "pct": -83.28
      }
     },
     {
      "value": 0.0854,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -526.39,
       "pct": -95.36
      },
      "vs_mark": {
       "pnl": -649.39,
       "pct": -96.21
      }
     },
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -552.0,
       "pct": -100.0
      },
      "vs_mark": {
       "pnl": -675.0,
       "pct": -100.0
      }
     }
    ]
   },
   {
    "name": "ATR −1× (prior close 499.10)",
    "tag": "ATR−1",
    "price": 492.9,
    "pct_from_spot": -1.42,
    "role": "atr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 0.4571,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -414.87,
       "pct": -75.16
      },
      "vs_mark": {
       "pnl": -537.87,
       "pct": -79.69
      }
     },
     {
      "value": 0.4126,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": -428.21,
       "pct": -77.57
      },
      "vs_mark": {
       "pnl": -551.21,
       "pct": -81.66
      }
     },
     {
      "value": 0.2539,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": -475.82,
       "pct": -86.2
      },
      "vs_mark": {
       "pnl": -598.82,
       "pct": -88.71
      }
     },
     {
      "value": 0.0438,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": -538.86,
       "pct": -97.62
      },
      "vs_mark": {
       "pnl": -661.86,
       "pct": -98.05
      }
     },
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -552.0,
       "pct": -100.0
      },
      "vs_mark": {
       "pnl": -675.0,
       "pct": -100.0
      }
     }
    ]
   },
   {
    "name": "Round below",
    "tag": "RND↓",
    "price": 490.0,
    "pct_from_spot": -2.0,
    "role": "sr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 0.1973,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -492.81,
       "pct": -89.28
      },
      "vs_mark": {
       "pnl": -615.81,
       "pct": -91.23
      }
     },
     {
      "value": 0.1716,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": -500.53,
       "pct": -90.68
      },
      "vs_mark": {
       "pnl": -623.53,
       "pct": -92.37
      }
     },
     {
      "value": 0.0876,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": -525.72,
       "pct": -95.24
      },
      "vs_mark": {
       "pnl": -648.72,
       "pct": -96.11
      }
     },
     {
      "value": 0.0068,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": -549.95,
       "pct": -99.63
      },
      "vs_mark": {
       "pnl": -672.95,
       "pct": -99.7
      }
     },
     {
      "value": 0.0,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": -552.0,
       "pct": -100.0
      },
      "vs_mark": {
       "pnl": -675.0,
       "pct": -100.0
      }
     }
    ]
   },
   {
    "name": "OCO take-profit leg",
    "tag": "TP leg",
    "price": null,
    "leg_price": 3.6,
    "role": "tp_leg",
    "cells": [
     {
      "underlying": 502.7859,
      "pct_from_spot": 0.56,
      "status": "ok"
     },
     {
      "underlying": 502.9651,
      "pct_from_spot": 0.59,
      "status": "ok"
     },
     {
      "underlying": 503.5925,
      "pct_from_spot": 0.72,
      "status": "ok"
     },
     {
      "underlying": 504.7426,
      "pct_from_spot": 0.95,
      "status": "ok"
     },
     {
      "underlying": 505.6015,
      "pct_from_spot": 1.12,
      "status": "ok"
     }
    ]
   },
   {
    "name": "OCO stop leg",
    "tag": "STOP leg",
    "price": null,
    "leg_price": 1.29,
    "role": "stop_leg",
    "cells": [
     {
      "underlying": 497.1995,
      "pct_from_spot": -0.56,
      "status": "ok"
     },
     {
      "underlying": 497.4684,
      "pct_from_spot": -0.51,
      "status": "ok"
     },
     {
      "underlying": 498.5438,
      "pct_from_spot": -0.29,
      "status": "ok"
     },
     {
      "underlying": 500.6649,
      "pct_from_spot": 0.13,
      "status": "ok"
     },
     {
      "underlying": 503.2938,
      "pct_from_spot": 0.66,
      "status": "ok"
     }
    ]
   }
  ],
  "target": {
   "price": 503.2,
   "name": "Overhead swing 1",
   "tag": "OH1",
   "source": "structural"
  },
  "stop": {
   "price": 497.4,
   "name": "Underfoot swing 1",
   "tag": "UF1",
   "source": "structural_beyond_cloud",
   "premium_ref": null,
   "underlying_per_column": [
    497.4,
    497.4,
    497.4,
    497.4,
    497.4
   ]
  },
  "summary": [
   {
    "label": "Now",
    "breakeven": 500.0077,
    "breakeven_pct": 0.0,
    "reward": 1.5795,
    "risk": 0.9026,
    "reward_dollars": 473.84,
    "risk_dollars": 270.77,
    "rr": 1.75,
    "clears_gate": true,
    "expected_move_1sigma": 0.0,
    "touch_prob_target": null,
    "touch_prob_stop": null,
    "stop_underlying": 497.4,
    "low_confidence": false,
    "vs_cost": {
     "breakeven": 498.9322,
     "breakeven_pct": -0.21,
     "reward": 1.9895,
     "pnl_at_stop": -147.77
    }
   },
   {
    "label": "12:15",
    "breakeven": 500.2168,
    "breakeven_pct": 0.04,
    "reward": 1.4863,
    "risk": 0.9796,
    "reward_dollars": 445.88,
    "risk_dollars": 293.87,
    "rr": 1.517,
    "clears_gate": true,
    "expected_move_1sigma": 1.8167,
    "touch_prob_target": 0.0791,
    "touch_prob_stop": 0.1513,
    "stop_underlying": 497.4,
    "low_confidence": false,
    "vs_cost": {
     "breakeven": 499.1712,
     "breakeven_pct": -0.17,
     "reward": 1.8963,
     "pnl_at_stop": -170.87
    }
   },
   {
    "label": "Close",
    "breakeven": 501.0532,
    "breakeven_pct": 0.21,
    "reward": 1.1118,
    "risk": 1.2802,
    "reward_dollars": 333.55,
    "risk_dollars": 384.06,
    "rr": 0.868,
    "clears_gate": false,
    "expected_move_1sigma": 3.9595,
    "touch_prob_target": 0.4205,
    "touch_prob_stop": 0.5103,
    "stop_underlying": 497.4,
    "low_confidence": false,
    "vs_cost": {
     "breakeven": 500.0973,
     "breakeven_pct": 0.02,
     "reward": 1.5218,
     "pnl_at_stop": -261.06
    }
   },
   {
    "label": "Thu close",
    "breakeven": 502.6664,
    "breakeven_pct": 0.53,
    "reward": 0.3168,
    "risk": 1.8469,
    "reward_dollars": 95.05,
    "risk_dollars": 554.06,
    "rr": 0.172,
    "clears_gate": false,
    "expected_move_1sigma": 6.0935,
    "touch_prob_target": 0.6006,
    "touch_prob_stop": 0.6688,
    "stop_underlying": 497.4,
    "low_confidence": false,
    "vs_cost": {
     "breakeven": 501.8897,
     "breakeven_pct": 0.38,
     "reward": 0.7268,
     "pnl_at_stop": -431.06
    }
   },
   {
    "label": "Expiry",
    "breakeven": 504.2497,
    "breakeven_pct": 0.85,
    "reward": -1.05,
    "risk": 2.25,
    "reward_dollars": -315.0,
    "risk_dollars": 675.0,
    "rr": null,
    "clears_gate": false,
    "expected_move_1sigma": 7.6541,
    "touch_prob_target": 0.6769,
    "touch_prob_stop": 0.7334,
    "stop_underlying": 497.4,
    "low_confidence": false,
    "vs_cost": {
     "breakeven": 503.839,
     "breakeven_pct": 0.77,
     "reward": -0.64,
     "pnl_at_stop": -552.0
    }
   }
  ],
  "stale_at": {
   "index": 2,
   "label": "Close",
   "ts": "2026-11-18T16:00:00-05:00"
  },
  "legs": {
   "tp_leg": {
    "leg_price": 3.6
   },
   "stop_leg": {
    "leg_price": 1.29
   },
   "reason": null
  },
  "warnings": [
   "atr_anchor: bar for last completed session 2026-11-17 missing — anchored on 2026-11-16"
  ]
 },
 "position_nolegs": {
  "available": true,
  "mode": "position",
  "contract": {
   "ticker": "SPY",
   "strike": 503.0,
   "expiry": "2026-11-20",
   "right": "put",
   "option_symbol": "SPY261120P00503000"
  },
  "position_id": "mock-pos-nolegs",
  "qty": 1,
  "now": "2026-11-19T14:40:00-05:00",
  "spot": 500.0,
  "spot_source": "position_live",
  "basis": {
   "type": "mark",
   "price": 2.9
  },
  "cost": 3.4,
  "mid": 2.9,
  "sigma_trading": 0.155528,
  "iv_display": 0.2,
  "sigma_source": "vendor_iv",
  "daily_atr": 6.2,
  "prev_close": 499.1,
  "atr_anchor_date": "2026-11-18",
  "columns": [
   {
    "label": "Now",
    "ts": "2026-11-19T14:40:00-05:00",
    "t_years": 0.004782254782254782,
    "is_expiry": false,
    "low_confidence": false,
    "expected_move_1sigma": 0.0
   },
   {
    "label": "15:40",
    "ts": "2026-11-19T15:40:00-05:00",
    "t_years": 0.004171754171754171,
    "is_expiry": false,
    "low_confidence": false,
    "expected_move_1sigma": 1.9214
   },
   {
    "label": "Close",
    "ts": "2026-11-19T16:00:00-05:00",
    "t_years": 0.003968253968253968,
    "is_expiry": false,
    "low_confidence": false,
    "expected_move_1sigma": 2.2187
   },
   {
    "label": "Fri 10:00",
    "ts": "2026-11-20T10:00:00-05:00",
    "t_years": 0.003663003663003663,
    "is_expiry": false,
    "low_confidence": false,
    "expected_move_1sigma": 2.6016
   },
   {
    "label": "Fri 12:00",
    "ts": "2026-11-20T12:00:00-05:00",
    "t_years": 0.002442002442002442,
    "is_expiry": false,
    "low_confidence": false,
    "expected_move_1sigma": 3.7619
   },
   {
    "label": "Fri 14:00",
    "ts": "2026-11-20T14:00:00-05:00",
    "t_years": 0.001221001221001221,
    "is_expiry": false,
    "low_confidence": false,
    "expected_move_1sigma": 4.6407
   },
   {
    "label": "Expiry",
    "ts": "2026-11-20T16:00:00-05:00",
    "t_years": 0.0,
    "is_expiry": true,
    "low_confidence": false,
    "expected_move_1sigma": 5.3777
   }
  ],
  "rows": [
   {
    "name": "ATR −1× (prior close 499.10)",
    "tag": "ATR−1",
    "price": 492.9,
    "pct_from_spot": -1.42,
    "role": "atr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 10.1,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 670.0,
       "pct": 197.06
      },
      "vs_mark": {
       "pnl": 720.0,
       "pct": 248.28
      }
     },
     {
      "value": 10.1,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 670.0,
       "pct": 197.06
      },
      "vs_mark": {
       "pnl": 720.0,
       "pct": 248.28
      }
     },
     {
      "value": 10.1,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 670.0,
       "pct": 197.06
      },
      "vs_mark": {
       "pnl": 720.0,
       "pct": 248.28
      }
     },
     {
      "value": 10.1,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 670.0,
       "pct": 197.06
      },
      "vs_mark": {
       "pnl": 720.0,
       "pct": 248.28
      }
     },
     {
      "value": 10.1,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 670.0,
       "pct": 197.06
      },
      "vs_mark": {
       "pnl": 720.0,
       "pct": 248.28
      }
     },
     {
      "value": 10.1,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 670.0,
       "pct": 197.06
      },
      "vs_mark": {
       "pnl": 720.0,
       "pct": 248.28
      }
     },
     {
      "value": 10.1,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 670.0,
       "pct": 197.06
      },
      "vs_mark": {
       "pnl": 720.0,
       "pct": 248.28
      }
     }
    ]
   },
   {
    "name": "Underfoot swing 2",
    "tag": "UF2",
    "price": 494.1,
    "pct_from_spot": -1.18,
    "role": "sr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 8.9166,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 551.66,
       "pct": 162.25
      },
      "vs_mark": {
       "pnl": 601.66,
       "pct": 207.47
      }
     },
     {
      "value": 8.9,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 550.0,
       "pct": 161.76
      },
      "vs_mark": {
       "pnl": 600.0,
       "pct": 206.9
      }
     },
     {
      "value": 8.9,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 550.0,
       "pct": 161.76
      },
      "vs_mark": {
       "pnl": 600.0,
       "pct": 206.9
      }
     },
     {
      "value": 8.9,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 550.0,
       "pct": 161.76
      },
      "vs_mark": {
       "pnl": 600.0,
       "pct": 206.9
      }
     },
     {
      "value": 8.9,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 550.0,
       "pct": 161.76
      },
      "vs_mark": {
       "pnl": 600.0,
       "pct": 206.9
      }
     },
     {
      "value": 8.9,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 550.0,
       "pct": 161.76
      },
      "vs_mark": {
       "pnl": 600.0,
       "pct": 206.9
      }
     },
     {
      "value": 8.9,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 550.0,
       "pct": 161.76
      },
      "vs_mark": {
       "pnl": 600.0,
       "pct": 206.9
      }
     }
    ]
   },
   {
    "name": "ATR −0.618× (prior close 499.10)",
    "tag": "ATR−0.618",
    "price": 495.2684,
    "pct_from_spot": -0.95,
    "role": "atr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 7.8227,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 442.27,
       "pct": 130.08
      },
      "vs_mark": {
       "pnl": 492.27,
       "pct": 169.75
      }
     },
     {
      "value": 7.7863,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 438.63,
       "pct": 129.01
      },
      "vs_mark": {
       "pnl": 488.63,
       "pct": 168.49
      }
     },
     {
      "value": 7.7752,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 437.52,
       "pct": 128.68
      },
      "vs_mark": {
       "pnl": 487.52,
       "pct": 168.11
      }
     },
     {
      "value": 7.7596,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 435.96,
       "pct": 128.22
      },
      "vs_mark": {
       "pnl": 485.96,
       "pct": 167.57
      }
     },
     {
      "value": 7.7316,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 433.16,
       "pct": 127.4
      },
      "vs_mark": {
       "pnl": 483.16,
       "pct": 166.61
      }
     },
     {
      "value": 7.7316,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 433.16,
       "pct": 127.4
      },
      "vs_mark": {
       "pnl": 483.16,
       "pct": 166.61
      }
     },
     {
      "value": 7.7316,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 433.16,
       "pct": 127.4
      },
      "vs_mark": {
       "pnl": 483.16,
       "pct": 166.61
      }
     }
    ]
   },
   {
    "name": "Underfoot swing 1",
    "tag": "UF1",
    "price": 497.4,
    "pct_from_spot": -0.52,
    "role": "sr",
    "is_target": true,
    "is_stop": false,
    "merged": [
     "ATR−0.382",
     "ATR−0.236"
    ],
    "cells": [
     {
      "value": 5.9325,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 253.25,
       "pct": 74.49
      },
      "vs_mark": {
       "pnl": 303.25,
       "pct": 104.57
      }
     },
     {
      "value": 5.8623,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 246.23,
       "pct": 72.42
      },
      "vs_mark": {
       "pnl": 296.23,
       "pct": 102.15
      }
     },
     {
      "value": 5.8391,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": 243.91,
       "pct": 71.74
      },
      "vs_mark": {
       "pnl": 293.91,
       "pct": 101.35
      }
     },
     {
      "value": 5.8049,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 240.49,
       "pct": 70.73
      },
      "vs_mark": {
       "pnl": 290.49,
       "pct": 100.17
      }
     },
     {
      "value": 5.6787,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 227.87,
       "pct": 67.02
      },
      "vs_mark": {
       "pnl": 277.87,
       "pct": 95.82
      }
     },
     {
      "value": 5.6,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 220.0,
       "pct": 64.71
      },
      "vs_mark": {
       "pnl": 270.0,
       "pct": 93.1
      }
     },
     {
      "value": 5.6,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 220.0,
       "pct": 64.71
      },
      "vs_mark": {
       "pnl": 270.0,
       "pct": 93.1
      }
     }
    ]
   },
   {
    "name": "10m 5/12 cloud bottom",
    "tag": "5/12▼",
    "price": 499.0,
    "pct_from_spot": -0.2,
    "role": "cloud",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 4.6421,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 124.21,
       "pct": 36.53
      },
      "vs_mark": {
       "pnl": 174.21,
       "pct": 60.07
      }
     },
     {
      "value": 4.5446,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 114.46,
       "pct": 33.66
      },
      "vs_mark": {
       "pnl": 164.46,
       "pct": 56.71
      }
     },
     {
      "value": 4.5115,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 111.15,
       "pct": 32.69
      },
      "vs_mark": {
       "pnl": 161.15,
       "pct": 55.57
      }
     },
     {
      "value": 4.4613,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 106.13,
       "pct": 31.21
      },
      "vs_mark": {
       "pnl": 156.13,
       "pct": 53.84
      }
     },
     {
      "value": 4.256,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 85.6,
       "pct": 25.18
      },
      "vs_mark": {
       "pnl": 135.6,
       "pct": 46.76
      }
     },
     {
      "value": 4.0628,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 66.28,
       "pct": 19.49
      },
      "vs_mark": {
       "pnl": 116.28,
       "pct": 40.1
      }
     },
     {
      "value": 4.0,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 60.0,
       "pct": 17.65
      },
      "vs_mark": {
       "pnl": 110.0,
       "pct": 37.93
      }
     }
    ]
   },
   {
    "name": "10m 5/12 cloud top",
    "tag": "5/12▲",
    "price": 499.8,
    "pct_from_spot": -0.04,
    "role": "cloud",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 4.0499,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 64.99,
       "pct": 19.11
      },
      "vs_mark": {
       "pnl": 114.99,
       "pct": 39.65
      }
     },
     {
      "value": 3.94,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 54.0,
       "pct": 15.88
      },
      "vs_mark": {
       "pnl": 104.0,
       "pct": 35.86
      }
     },
     {
      "value": 3.9022,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 50.22,
       "pct": 14.77
      },
      "vs_mark": {
       "pnl": 100.22,
       "pct": 34.56
      }
     },
     {
      "value": 3.8445,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 44.45,
       "pct": 13.07
      },
      "vs_mark": {
       "pnl": 94.45,
       "pct": 32.57
      }
     },
     {
      "value": 3.5998,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 19.98,
       "pct": 5.88
      },
      "vs_mark": {
       "pnl": 69.98,
       "pct": 24.13
      }
     },
     {
      "value": 3.3395,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -6.05,
       "pct": -1.78
      },
      "vs_mark": {
       "pnl": 43.95,
       "pct": 15.15
      }
     },
     {
      "value": 3.2,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -20.0,
       "pct": -5.88
      },
      "vs_mark": {
       "pnl": 30.0,
       "pct": 10.34
      }
     }
    ]
   },
   {
    "name": "Spot",
    "tag": "SPOT",
    "price": 500.0,
    "pct_from_spot": 0.0,
    "role": "spot",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 3.908,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 50.8,
       "pct": 14.94
      },
      "vs_mark": {
       "pnl": 100.8,
       "pct": 34.76
      }
     },
     {
      "value": 3.7953,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 39.53,
       "pct": 11.63
      },
      "vs_mark": {
       "pnl": 89.53,
       "pct": 30.87
      }
     },
     {
      "value": 3.7564,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 35.64,
       "pct": 10.48
      },
      "vs_mark": {
       "pnl": 85.64,
       "pct": 29.53
      }
     },
     {
      "value": 3.697,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 29.7,
       "pct": 8.73
      },
      "vs_mark": {
       "pnl": 79.7,
       "pct": 27.48
      }
     },
     {
      "value": 3.4429,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 4.29,
       "pct": 1.26
      },
      "vs_mark": {
       "pnl": 54.29,
       "pct": 18.72
      }
     },
     {
      "value": 3.1655,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -23.45,
       "pct": -6.9
      },
      "vs_mark": {
       "pnl": 26.55,
       "pct": 9.16
      }
     },
     {
      "value": 3.0,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -40.0,
       "pct": -11.76
      },
      "vs_mark": {
       "pnl": 10.0,
       "pct": 3.45
      }
     }
    ]
   },
   {
    "name": "ATR +0.236× (prior close 499.10)",
    "tag": "ATR+0.236",
    "price": 500.5632,
    "pct_from_spot": 0.11,
    "role": "atr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 3.5225,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 12.25,
       "pct": 3.6
      },
      "vs_mark": {
       "pnl": 62.25,
       "pct": 21.47
      }
     },
     {
      "value": 3.4024,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": 0.24,
       "pct": 0.07
      },
      "vs_mark": {
       "pnl": 50.24,
       "pct": 17.32
      }
     },
     {
      "value": 3.3608,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -3.92,
       "pct": -1.15
      },
      "vs_mark": {
       "pnl": 46.08,
       "pct": 15.89
      }
     },
     {
      "value": 3.2968,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -10.32,
       "pct": -3.04
      },
      "vs_mark": {
       "pnl": 39.68,
       "pct": 13.68
      }
     },
     {
      "value": 3.0181,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -38.19,
       "pct": -11.23
      },
      "vs_mark": {
       "pnl": 11.81,
       "pct": 4.07
      }
     },
     {
      "value": 2.6939,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -70.61,
       "pct": -20.77
      },
      "vs_mark": {
       "pnl": -20.61,
       "pct": -7.11
      }
     },
     {
      "value": 2.4368,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -96.32,
       "pct": -28.33
      },
      "vs_mark": {
       "pnl": -46.32,
       "pct": -15.97
      }
     }
    ]
   },
   {
    "name": "ATR +0.382× (prior close 499.10)",
    "tag": "ATR+0.382",
    "price": 501.4684,
    "pct_from_spot": 0.29,
    "role": "atr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 2.9481,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -45.19,
       "pct": -13.29
      },
      "vs_mark": {
       "pnl": 4.81,
       "pct": 1.66
      }
     },
     {
      "value": 2.8187,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -58.13,
       "pct": -17.1
      },
      "vs_mark": {
       "pnl": -8.13,
       "pct": -2.8
      }
     },
     {
      "value": 2.7736,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -62.64,
       "pct": -18.42
      },
      "vs_mark": {
       "pnl": -12.64,
       "pct": -4.36
      }
     },
     {
      "value": 2.7038,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -69.62,
       "pct": -20.48
      },
      "vs_mark": {
       "pnl": -19.62,
       "pct": -6.77
      }
     },
     {
      "value": 2.3933,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -100.67,
       "pct": -29.61
      },
      "vs_mark": {
       "pnl": -50.67,
       "pct": -17.47
      }
     },
     {
      "value": 2.0043,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -139.57,
       "pct": -41.05
      },
      "vs_mark": {
       "pnl": -89.57,
       "pct": -30.89
      }
     },
     {
      "value": 1.5316,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -186.84,
       "pct": -54.95
      },
      "vs_mark": {
       "pnl": -136.84,
       "pct": -47.19
      }
     }
    ]
   },
   {
    "name": "ATR +0.618× (prior close 499.10)",
    "tag": "ATR+0.618",
    "price": 502.9316,
    "pct_from_spot": 0.59,
    "role": "atr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 2.144,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -125.6,
       "pct": -36.94
      },
      "vs_mark": {
       "pnl": -75.6,
       "pct": -26.07
      }
     },
     {
      "value": 2.0077,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": -139.23,
       "pct": -40.95
      },
      "vs_mark": {
       "pnl": -89.23,
       "pct": -30.77
      }
     },
     {
      "value": 1.96,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": -144.0,
       "pct": -42.35
      },
      "vs_mark": {
       "pnl": -94.0,
       "pct": -32.41
      }
     },
     {
      "value": 1.886,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": -151.4,
       "pct": -44.53
      },
      "vs_mark": {
       "pnl": -101.4,
       "pct": -34.97
      }
     },
     {
      "value": 1.5517,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -184.83,
       "pct": -54.36
      },
      "vs_mark": {
       "pnl": -134.83,
       "pct": -46.49
      }
     },
     {
      "value": 1.1125,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -228.75,
       "pct": -67.28
      },
      "vs_mark": {
       "pnl": -178.75,
       "pct": -61.64
      }
     },
     {
      "value": 0.0684,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -333.16,
       "pct": -97.99
      },
      "vs_mark": {
       "pnl": -283.16,
       "pct": -97.64
      }
     }
    ]
   },
   {
    "name": "ATR +1× (prior close 499.10)",
    "tag": "ATR+1",
    "price": 505.3,
    "pct_from_spot": 1.06,
    "role": "atr",
    "is_target": false,
    "is_stop": false,
    "merged": [],
    "cells": [
     {
      "value": 1.1727,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -222.73,
       "pct": -65.51
      },
      "vs_mark": {
       "pnl": -172.73,
       "pct": -59.56
      }
     },
     {
      "value": 1.0481,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": -235.19,
       "pct": -69.17
      },
      "vs_mark": {
       "pnl": -185.19,
       "pct": -63.86
      }
     },
     {
      "value": 1.0048,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": -239.52,
       "pct": -70.45
      },
      "vs_mark": {
       "pnl": -189.52,
       "pct": -65.35
      }
     },
     {
      "value": 0.9382,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": -246.18,
       "pct": -72.4
      },
      "vs_mark": {
       "pnl": -196.18,
       "pct": -67.65
      }
     },
     {
      "value": 0.6469,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": -275.31,
       "pct": -80.97
      },
      "vs_mark": {
       "pnl": -225.31,
       "pct": -77.69
      }
     },
     {
      "value": 0.3021,
      "beyond_1sigma": true,
      "vs_cost": {
       "pnl": -309.79,
       "pct": -91.11
      },
      "vs_mark": {
       "pnl": -259.79,
       "pct": -89.58
      }
     },
     {
      "value": 0.0,
      "beyond_1sigma": false,
      "vs_cost": {
       "pnl": -340.0,
       "pct": -100.0
      },
      "vs_mark": {
       "pnl": -290.0,
       "pct": -100.0
      }
     }
    ]
   }
  ],
  "target": {
   "price": 497.4,
   "name": "Underfoot swing 1",
   "tag": "UF1",
   "source": "structural"
  },
  "stop": {
   "price": null,
   "name": "−30% of premium",
   "tag": "STOP−30%",
   "source": "premium_fallback",
   "premium_ref": 3.4,
   "underlying_per_column": [
    502.4704,
    502.2309,
    502.1411,
    502.0064,
    501.4826,
    500.9588,
    500.622
   ]
  },
  "summary": [
   {
    "label": "Now",
    "breakeven": 501.5425,
    "breakeven_pct": 0.31,
    "reward": 3.0325,
    "risk": 0.52,
    "reward_dollars": 303.25,
    "risk_dollars": 52.0,
    "rr": 5.832,
    "clears_gate": true,
    "expected_move_1sigma": 0.0,
    "touch_prob_target": null,
    "touch_prob_stop": null,
    "stop_underlying": 502.4704,
    "low_confidence": false,
    "vs_cost": {
     "breakeven": 500.7493,
     "breakeven_pct": 0.15,
     "reward": 2.5325,
     "pnl_at_stop": -102.0
    }
   },
   {
    "label": "15:40",
    "breakeven": 501.333,
    "breakeven_pct": 0.27,
    "reward": 2.9623,
    "risk": 0.52,
    "reward_dollars": 296.23,
    "risk_dollars": 52.0,
    "rr": 5.697,
    "clears_gate": true,
    "expected_move_1sigma": 1.9214,
    "touch_prob_target": 0.1749,
    "touch_prob_stop": 0.2467,
    "stop_underlying": 502.2309,
    "low_confidence": false,
    "vs_cost": {
     "breakeven": 500.5697,
     "breakeven_pct": 0.11,
     "reward": 2.4623,
     "pnl_at_stop": -102.0
    }
   },
   {
    "label": "Close",
    "breakeven": 501.2581,
    "breakeven_pct": 0.25,
    "reward": 2.9391,
    "risk": 0.52,
    "reward_dollars": 293.91,
    "risk_dollars": 52.0,
    "rr": 5.652,
    "clears_gate": true,
    "expected_move_1sigma": 2.2187,
    "touch_prob_target": 0.24,
    "touch_prob_stop": 0.3356,
    "stop_underlying": 502.1411,
    "low_confidence": false,
    "vs_cost": {
     "breakeven": 500.5098,
     "breakeven_pct": 0.1,
     "reward": 2.4391,
     "pnl_at_stop": -102.0
    }
   },
   {
    "label": "Fri 10:00",
    "breakeven": 501.1534,
    "breakeven_pct": 0.23,
    "reward": 2.9049,
    "risk": 0.52,
    "reward_dollars": 290.49,
    "risk_dollars": 52.0,
    "rr": 5.586,
    "clears_gate": true,
    "expected_move_1sigma": 2.6016,
    "touch_prob_target": 0.3163,
    "touch_prob_stop": 0.4415,
    "stop_underlying": 502.0064,
    "low_confidence": false,
    "vs_cost": {
     "breakeven": 500.42,
     "breakeven_pct": 0.08,
     "reward": 2.4049,
     "pnl_at_stop": -102.0
    }
   },
   {
    "label": "Fri 12:00",
    "breakeven": 500.7268,
    "breakeven_pct": 0.15,
    "reward": 2.7787,
    "risk": 0.52,
    "reward_dollars": 277.87,
    "risk_dollars": 52.0,
    "rr": 5.344,
    "clears_gate": true,
    "expected_move_1sigma": 3.7619,
    "touch_prob_target": 0.4883,
    "touch_prob_stop": 0.6939,
    "stop_underlying": 501.4826,
    "low_confidence": false,
    "vs_cost": {
     "breakeven": 500.0608,
     "breakeven_pct": 0.01,
     "reward": 2.2787,
     "pnl_at_stop": -102.0
    }
   },
   {
    "label": "Fri 14:00",
    "breakeven": 500.3152,
    "breakeven_pct": 0.06,
    "reward": 2.7,
    "risk": 0.52,
    "reward_dollars": 270.0,
    "risk_dollars": 52.0,
    "rr": 5.192,
    "clears_gate": true,
    "expected_move_1sigma": 4.6407,
    "touch_prob_target": 0.5743,
    "touch_prob_stop": 0.8365,
    "stop_underlying": 500.9588,
    "low_confidence": false,
    "vs_cost": {
     "breakeven": 499.7315,
     "breakeven_pct": -0.05,
     "reward": 2.2,
     "pnl_at_stop": -102.0
    }
   },
   {
    "label": "Expiry",
    "breakeven": 500.0982,
    "breakeven_pct": 0.02,
    "reward": 2.7,
    "risk": 0.52,
    "reward_dollars": 270.0,
    "risk_dollars": 52.0,
    "rr": 5.192,
    "clears_gate": true,
    "expected_move_1sigma": 5.3777,
    "touch_prob_target": 0.6279,
    "touch_prob_stop": 0.908,
    "stop_underlying": 500.622,
    "low_confidence": false,
    "vs_cost": {
     "breakeven": 499.5968,
     "breakeven_pct": -0.08,
     "reward": 2.2,
     "pnl_at_stop": -102.0
    }
   }
  ],
  "stale_at": null,
  "legs": {
   "tp_leg": null,
   "stop_leg": null,
   "reason": "broker leg reads use the /api/orders/working gate (kill-switch on + admin)"
  },
  "warnings": [
   "vendor_iv_fallback: σ from Tradier IV (converted to trading basis), not the mid",
   "stop_fallback: no structural stop — using −30% of premium per column"
  ]
 }
};
