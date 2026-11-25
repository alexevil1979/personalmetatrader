//+------------------------------------------------------------------+
//| Price Channel + Trend Flip  (ручной порт Pine Script v5 -> MQL5)  |
//| Порт: сигналы Price Channel, стрелки Trend Flip, уровни разворота |
//| Не портировано: таблица, H4/D1-блоки (в оригинале ничего не       |
//| рисуют), Special 2-3-4 (в оригинале отключён), подписи Δ.         |
//+------------------------------------------------------------------+
#property description "Port of Pine 'Price Channel + Trend Flip'"
#property indicator_chart_window
#property indicator_buffers 14
#property indicator_plots   14

#property indicator_type1  DRAW_ARROW
#property indicator_color1 clrLimeGreen
#property indicator_label1 "BUY (channel)"
#property indicator_type2  DRAW_ARROW
#property indicator_color2 clrRed
#property indicator_label2 "SELL (channel)"
#property indicator_type3  DRAW_ARROW
#property indicator_color3 clrCrimson
#property indicator_label3 "Flip UP"
#property indicator_type4  DRAW_ARROW
#property indicator_color4 clrSeaGreen
#property indicator_label4 "Flip DOWN"
#property indicator_type5  DRAW_LINE
#property indicator_color5 clrLimeGreen
#property indicator_width5 2
#property indicator_label5 "Up lvl 1"
#property indicator_type6  DRAW_LINE
#property indicator_color6 clrSeaGreen
#property indicator_width6 2
#property indicator_label6 "Up lvl 2"
#property indicator_type7  DRAW_LINE
#property indicator_color7 clrSeaGreen
#property indicator_label7 "Up lvl 3"
#property indicator_type8  DRAW_LINE
#property indicator_color8 clrDarkGray
#property indicator_label8 "Up lvl 4"
#property indicator_type9  DRAW_LINE
#property indicator_color9 clrDarkGray
#property indicator_label9 "Up lvl 5"
#property indicator_type10 DRAW_LINE
#property indicator_color10 clrRed
#property indicator_width10 2
#property indicator_label10 "Down lvl 1"
#property indicator_type11 DRAW_LINE
#property indicator_color11 clrOrangeRed
#property indicator_width11 2
#property indicator_label11 "Down lvl 2"
#property indicator_type12 DRAW_LINE
#property indicator_color12 clrOrangeRed
#property indicator_label12 "Down lvl 3"
#property indicator_type13 DRAW_LINE
#property indicator_color13 clrDarkGray
#property indicator_label13 "Down lvl 4"
#property indicator_type14 DRAW_LINE
#property indicator_color14 clrDarkGray
#property indicator_label14 "Down lvl 5"

input int  InpLength       = 20;   // Price Channel: Length
input bool InpShowSignals  = true; // Price Channel: показывать сигналы
input bool InpShowFlip     = true; // Trend Flip: показывать стрелки
input int  InpLinesCount   = 5;    // Trend Flip: уровней на сторону (1..5)

double Buy[], Sell[], FlipUp[], FlipDn[];
double U1[], U2[], U3[], U4[], U5[];
double D1[], D2[], D3[], D4[], D5[];

int OnInit()
{
   SetIndexBuffer(0, Buy, INDICATOR_DATA);   SetIndexBuffer(1, Sell, INDICATOR_DATA);
   SetIndexBuffer(2, FlipUp, INDICATOR_DATA); SetIndexBuffer(3, FlipDn, INDICATOR_DATA);
   SetIndexBuffer(4, U1, INDICATOR_DATA);  SetIndexBuffer(5, U2, INDICATOR_DATA);  SetIndexBuffer(6, U3, INDICATOR_DATA);
   SetIndexBuffer(7, U4, INDICATOR_DATA);  SetIndexBuffer(8, U5, INDICATOR_DATA);
   SetIndexBuffer(9, D1, INDICATOR_DATA);  SetIndexBuffer(10, D2, INDICATOR_DATA); SetIndexBuffer(11, D3, INDICATOR_DATA);
   SetIndexBuffer(12, D4, INDICATOR_DATA); SetIndexBuffer(13, D5, INDICATOR_DATA);
   return(INIT_SUCCEEDED);
}

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[],
                const double &open[], const double &high[], const double &low[], const double &close[],
                const long &tick_volume[], const long &volume[], const int &spread[])
{
   int len = InpLength; if(len < 1) len = 1;
   int cnt = InpLinesCount; if(cnt < 1) cnt = 1; if(cnt > 5) cnt = 5;

   // --- состояние Trend Flip (как var-переменные Pine)
   bool   inited = false;
   int    trend = 0;               // 1 = up, -1 = down
   double lastFlipClose = 0, extOpen = 0, extClose = 0, flipLevel = 0;
   double upL[5], dnL[5];
   for(int k = 0; k < 5; k++) { upL[k] = EMPTY_VALUE; dnL[k] = EMPTY_VALUE; }
   string lastDir = "";
   double firstOpen = EMPTY_VALUE, lastSigClose = EMPTY_VALUE;
   int flips = 0, buys = 0, sells = 0;

   for(int i = 0; i < rates_total; i++)
   {
      Buy[i] = EMPTY_VALUE; Sell[i] = EMPTY_VALUE; FlipUp[i] = EMPTY_VALUE; FlipDn[i] = EMPTY_VALUE;
      double rng = high[i] - low[i];

      // --- Price Channel: high == highest(high,len)[1], low == lowest(low,len)[1]
      if(InpShowSignals && i >= len)
      {
         double hh = high[i - len], ll = low[i - len];
         for(int j = i - len; j <= i - 1; j++) { if(high[j] > hh) hh = high[j]; if(low[j] < ll) ll = low[j]; }
         if(high[i] == hh) { Buy[i]  = low[i]  - rng * 0.3; buys++; }
         if(low[i]  == ll) { Sell[i] = high[i] + rng * 0.3; sells++; }
      }

      // --- Trend Flip
      if(!InpShowFlip) continue;
      if(!inited)
      {
         trend = (close[i] > open[i]) ? 1 : -1;
         lastFlipClose = close[i]; extOpen = open[i]; extClose = close[i]; inited = true;
      }
      bool flip = false;
      if(trend == 1)
      {
         if(close[i] > open[i]) { if(close[i] > extClose) { extClose = close[i]; extOpen = open[i]; } }
         else if(close[i] < extOpen) { flipLevel = extOpen; flip = true; trend = -1; extClose = close[i]; extOpen = open[i]; }
      }
      else
      {
         if(close[i] < open[i]) { if(close[i] < extClose) { extClose = close[i]; extOpen = open[i]; } }
         else if(close[i] > extOpen) { flipLevel = extOpen; flip = true; trend = 1; extClose = close[i]; extOpen = open[i]; }
      }
      if(flip)
      {
         flips++;
         if(i < rates_total - 1) { lastDir = (trend == 1) ? "ВВЕРХ" : "ВНИЗ"; firstOpen = extOpen; lastSigClose = close[i]; } // только закрытые бары
         if(trend == 1)
         {
            FlipUp[i] = low[i] - rng * 0.5;
            for(int k = 4; k > 0; k--) upL[k] = upL[k - 1];
            upL[0] = flipLevel;
         }
         else
         {
            FlipDn[i] = high[i] + rng * 0.5;
            for(int k = 4; k > 0; k--) dnL[k] = dnL[k - 1];
            dnL[0] = flipLevel;
         }
         lastFlipClose = close[i];
      }
   }

   // --- уровни: как в Pine, на графике остаются только последние уровни, линии идут через весь график (extend.both)
   for(int i = 0; i < rates_total; i++)
   {
      U1[i] = (cnt >= 1) ? upL[0] : EMPTY_VALUE; U2[i] = (cnt >= 2) ? upL[1] : EMPTY_VALUE; U3[i] = (cnt >= 3) ? upL[2] : EMPTY_VALUE;
      U4[i] = (cnt >= 4) ? upL[3] : EMPTY_VALUE; U5[i] = (cnt >= 5) ? upL[4] : EMPTY_VALUE;
      D1[i] = (cnt >= 1) ? dnL[0] : EMPTY_VALUE; D2[i] = (cnt >= 2) ? dnL[1] : EMPTY_VALUE; D3[i] = (cnt >= 3) ? dnL[2] : EMPTY_VALUE;
      D4[i] = (cnt >= 4) ? dnL[3] : EMPTY_VALUE; D5[i] = (cnt >= 5) ? dnL[4] : EMPTY_VALUE;
   }

   // --- «таблица» оригинала -> строка в имени индикатора
   string info = "TrendFlip";
   if(lastDir != "" && lastSigClose != EMPTY_VALUE)
   {
      double diff = close[rates_total - 1] - lastSigClose;
      if(lastDir == "ВНИЗ") diff = -diff;
      info = lastDir + " | " + DoubleToString(close[rates_total - 1], 2) + " - " + DoubleToString(lastSigClose, 2) + " = " + DoubleToString(diff, 2)
           + " | разворот " + DoubleToString(firstOpen, 2);
      if(diff > 3500 || diff < -1000) info = info + " | ⚠ Возможен разворот";
   }
   IndicatorSetString(INDICATOR_SHORTNAME, info);
   Print("flips=", flips, " buy=", buys, " sell=", sells);
   return(rates_total);
}
