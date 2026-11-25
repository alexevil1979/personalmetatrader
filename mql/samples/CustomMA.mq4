//+------------------------------------------------------------------+
//| Custom Moving Average (MQL4 style, written for PMT tests)         |
//+------------------------------------------------------------------+
#property copyright "PMT sample"
#property indicator_chart_window
#property indicator_buffers 1
#property indicator_color1 Red

//---- input parameters
extern int    MA_Period = 13;
extern int    MA_Shift  = 0;
extern int    MA_Method = MODE_SMMA;
//---- buffers
double ExtMapBuffer[];

int init()
{
   int draw_begin;
   SetIndexStyle(0, DRAW_LINE);
   SetIndexShift(0, MA_Shift);
   IndicatorDigits(Digits);
   if (MA_Period < 2) MA_Period = 13;
   draw_begin = MA_Period - 1;
   IndicatorShortName("CMA(" + MA_Period + ")");
   SetIndexDrawBegin(0, draw_begin);
   SetIndexBuffer(0, ExtMapBuffer);
   return(0);
}

int start()
{
   int ExtCountedBars = IndicatorCounted();
   if (ExtCountedBars < 0) return(-1);
   if (ExtCountedBars > 0) ExtCountedBars--;
   int pos = Bars - ExtCountedBars - 1;
   // simple moving average computed by hand
   while (pos >= 0)
   {
      double sum = 0;
      if (pos + MA_Period <= Bars)
      {
         for (int i = 0; i < MA_Period; i++) sum += Close[pos + i];
         ExtMapBuffer[pos] = sum / MA_Period;
      }
      pos--;
   }
   return(0);
}
