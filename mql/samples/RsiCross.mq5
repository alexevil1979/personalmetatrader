//+------------------------------------------------------------------+
//| RSI with cross arrows (MQL5 style, written for PMT tests)         |
//+------------------------------------------------------------------+
#property indicator_separate_window
#property indicator_buffers 3
#property indicator_plots   2
#property indicator_type1   DRAW_LINE
#property indicator_color1  clrDodgerBlue
#property indicator_width1  2
#property indicator_label1  "RSI"
#property indicator_type2   DRAW_ARROW
#property indicator_color2  clrOrange
#property indicator_label2  "Cross50"
#property indicator_minimum 0
#property indicator_maximum 100
#property indicator_level1  50

input int                InpPeriod = 14;
input ENUM_APPLIED_PRICE InpPrice  = PRICE_CLOSE;

double RsiBuf[];
double ArrowBuf[];
double HelperBuf[];
int    hRsi;

int OnInit()
{
   SetIndexBuffer(0, RsiBuf, INDICATOR_DATA);
   SetIndexBuffer(1, ArrowBuf, INDICATOR_DATA);
   SetIndexBuffer(2, HelperBuf, INDICATOR_CALCULATIONS);
   PlotIndexSetInteger(1, PLOT_ARROW, 159);
   PlotIndexSetDouble(0, PLOT_EMPTY_VALUE, EMPTY_VALUE);
   PlotIndexSetInteger(0, PLOT_DRAW_BEGIN, InpPeriod);
   IndicatorSetString(INDICATOR_SHORTNAME, "RSI x50 (" + IntegerToString(InpPeriod) + ")");
   hRsi = iRSI(_Symbol, _Period, InpPeriod, InpPrice);
   if (hRsi == INVALID_HANDLE) return(INIT_FAILED);
   return(INIT_SUCCEEDED);
}

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[],
                const double &open[], const double &high[], const double &low[], const double &close[],
                const long &tick_volume[], const long &volume[], const int &spread[])
{
   if (rates_total < InpPeriod + 2) return(0);
   if (CopyBuffer(hRsi, 0, 0, rates_total, RsiBuf) <= 0) return(0);
   for (int i = 1; i < rates_total; i++)
   {
      ArrowBuf[i] = EMPTY_VALUE;
      if (RsiBuf[i - 1] < 50.0 && RsiBuf[i] >= 50.0) ArrowBuf[i] = 50.0;
      if (RsiBuf[i - 1] > 50.0 && RsiBuf[i] <= 50.0) ArrowBuf[i] = 50.0;
   }
   return(rates_total);
}
