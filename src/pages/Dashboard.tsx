import React, { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid, AreaChart, Area, Legend, Cell } from 'recharts';
import { format } from 'date-fns';
import { AlertTriangle, TrendingDown, BookOpen, Activity, Database, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export default function DashboardPage() {
  const [scores, setScores] = useState<any[]>([]);
  const [articles, setArticles] = useState<any[]>([]);
  const [latestReport, setLatestReport] = useState<any>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/data');
        const data = await res.json();
        if (data.scores) setScores(data.scores.reverse());
        if (data.articles) setArticles(data.articles);
        if (data.latestReport) setLatestReport(data.latestReport);
      } catch (e) {
        console.error('Failed to fetch data', e);
      }
    };
    
    fetchData();
    const interval = setInterval(fetchData, 10000); // 10s auto-refresh
    return () => clearInterval(interval);
  }, []);

  const currentScore = scores.length > 0 ? scores[scores.length - 1].score : 0;
  const isHighRisk = currentScore > 70;

  // Chart Data formatters
  const scoreChartData = scores.map(s => ({
    time: format(new Date(s.timestamp), 'MMM dd HH:mm'),
    Risk: s.score
  }));

  // Bar chart (News volume by risk type)
  const riskVolume = articles.reduce((acc: any, curr) => {
    acc[curr.riskType] = (acc[curr.riskType] || 0) + 1;
    return acc;
  }, {});
  const volumeChartData = Object.keys(riskVolume).filter(k => k !== 'No Risk').map(k => ({
    name: k,
    count: riskVolume[k]
  })).sort((a, b) => b.count - a.count);

  // Heatmap Processing
  const heatmapDays = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return format(d, 'EEE');
  }).reverse();
  const heatmapHours = Array.from({ length: 24 }).map((_, i) => i);
  const heatmapData: Record<string, number> = {};
  
  heatmapDays.forEach(d => {
    heatmapHours.forEach(h => {
      heatmapData[`${d}-${h}`] = 0;
    });
  });

  articles.forEach(article => {
    const date = new Date(article.timestamp);
    const day = format(date, 'EEE');
    const hour = date.getHours();
    const key = `${day}-${hour}`;
    if (heatmapData[key] !== undefined) {
      heatmapData[key] = Math.max(heatmapData[key], article.riskSeverity); 
    }
  });

  // Sentiment Trend Processing
  const sentimentByTime: Record<string, any> = {};
  const allAssetsInSentiment = new Set<string>();
  
  [...articles].reverse().forEach(article => {
    const timeKey = format(new Date(article.timestamp), 'HH:00');
    let assets: string[] = [];
    try {
      assets = JSON.parse(article.affectedAssets || '[]');
    } catch(e) {}
    
    if (!sentimentByTime[timeKey]) {
      sentimentByTime[timeKey] = { time: timeKey, count: {} };
    }
    
    assets.forEach(asset => {
      allAssetsInSentiment.add(asset);
      if (typeof sentimentByTime[timeKey][asset] === 'undefined') {
        sentimentByTime[timeKey][asset] = 0;
        sentimentByTime[timeKey].count[asset] = 0;
      }
      sentimentByTime[timeKey][asset] += article.sentimentScore;
      sentimentByTime[timeKey].count[asset] += 1;
    });
  });

  const sentimentChartData = Object.keys(sentimentByTime).map(time => {
    const p: any = { time };
    const bucket = sentimentByTime[time];
    Object.keys(bucket).forEach(k => {
      if (k !== 'time' && k !== 'count') {
        p[k] = Number((bucket[k] / bucket.count[k]).toFixed(2));
      }
    });
    return p;
  });

  const ASSET_COLORS: Record<string, string> = {
    'Equities': '#3b82f6',
    'Bonds': '#8b5cf6',
    'Commodities': '#f59e0b',
    'Crypto': '#10b981',
    'FX': '#06b6d4',
    'Real Estate': '#ec4899'
  };

  // Gauge calculation
  const gaugeColor = isHighRisk ? '#ef4444' : currentScore > 40 ? '#fbbf24' : '#34d399';
  const gaugePercent = Math.min(Math.max(currentScore, 0), 100) / 100;
  // Circumference of semi-circle with r=80 is ~251.3
  const gaugeDashArray = 251.3;
  const gaugeDashOffset = gaugeDashArray - (gaugePercent * gaugeDashArray);

  return (
    <div className="space-y-8">
      
      {/* Title Board */}
      <div className="bg-[#09090b] border border-zinc-800 rounded-2xl p-8 flex flex-col items-center justify-center text-center relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-zinc-500 to-transparent opacity-20"></div>
        <h2 className="text-3xl font-medium text-zinc-100 tracking-tight mb-3">Global Macro Risk Intelligence</h2>
        <p className="text-zinc-400 max-w-2xl text-sm leading-relaxed">
          Currently analyzing <strong className="text-zinc-300 font-medium">real-time global financial news</strong> and market movements across <strong className="text-zinc-300 font-medium">Equities (S&P 500), Commodities (Gold, Oil), Crypto (Bitcoin), and FX (EUR/USD)</strong>. Python engines process ingestion and calculations, while Gemini evaluates context to quantify systemic risk.
        </p>
      </div>

      {/* Automation Context Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-zinc-900 rounded-xl overflow-hidden border border-zinc-800">
        <div className="bg-[#09090b] p-6">
          <div className="text-zinc-500 uppercase tracking-widest text-[10px] font-semibold mb-4 flex items-center gap-2">
            <Database className="w-3.5 h-3.5"/> Data Ingestion
          </div>
          <ul className="space-y-2.5 text-sm text-zinc-400">
            <li className="flex items-center gap-2"><span className="w-1 h-1 bg-white rounded-full"></span> <span className="text-zinc-300 font-medium">Yahoo Finance:</span> Market prices</li>
            <li className="text-xs text-zinc-500 ml-3">S&P500, Gold, Oil, BTC, EUR/USD</li>
            <li className="flex items-center gap-2 mt-2"><span className="w-1 h-1 bg-white rounded-full"></span> <span className="text-zinc-300 font-medium">NewsAPI:</span> Top financial news</li>
            <li className="text-xs text-zinc-500 ml-3">100 articles / 30 mins</li>
          </ul>
        </div>
        <div className="bg-[#09090b] p-6">
          <div className="text-zinc-500 uppercase tracking-widest text-[10px] font-semibold mb-4 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5"/> Processing Engine
          </div>
          <ul className="space-y-2.5 text-sm text-zinc-400">
            <li className="flex items-center gap-2"><span className="w-1 h-1 bg-indigo-400 rounded-full"></span> VADER Sentiment Polarity</li>
            <li className="flex items-center gap-2"><span className="w-1 h-1 bg-indigo-400 rounded-full"></span> Price Volatility Variance Math</li>
            <li className="flex items-center gap-2"><span className="w-1 h-1 bg-indigo-400 rounded-full"></span> Aggregate Master Risk Scoring</li>
          </ul>
        </div>
        <div className="bg-[#09090b] p-6">
          <div className="text-zinc-500 uppercase tracking-widest text-[10px] font-semibold mb-4 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5"/> AI Inference Engine
          </div>
          <ul className="space-y-2.5 text-sm text-zinc-400">
            <li className="flex items-start gap-2">
              <span className="w-1 h-1 bg-amber-400 rounded-full mt-1.5"></span>
              <div>
                <span className="text-zinc-300 font-medium">Gemini 2.5 Flash:</span>
                <div className="text-xs text-zinc-500 mt-0.5">Article categorization & strict severities</div>
              </div>
            </li>
            <li className="flex items-start gap-2 mt-2">
              <span className="w-1 h-1 bg-amber-400 rounded-full mt-1.5"></span>
              <div>
                <span className="text-zinc-300 font-medium">Daily Briefings:</span>
                <div className="text-xs text-zinc-500 mt-0.5">Automated strategic market reports</div>
              </div>
            </li>
          </ul>
        </div>
      </div>

      {isHighRisk && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start gap-4">
          <AlertTriangle className="text-red-400 w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-red-400 font-medium text-sm">Critical Risk Alert</h3>
            <p className="text-red-400/80 text-sm mt-1">The master risk score has crossed 70. Review AI briefings immediately.</p>
          </div>
        </div>
      )}

      {/* Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-6 relative overflow-hidden group flex flex-col items-center justify-center">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="w-full text-left text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-2 flex items-center gap-2"><Activity className="w-3.5 h-3.5"/> Master Risk</div>
          <div className="relative w-48 h-28 -mb-4 flex items-end justify-center">
             <svg viewBox="0 0 200 110" className="w-full h-full drop-shadow-lg">
                <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#27272a" strokeWidth="16" strokeLinecap="round" />
                <path 
                  d="M 20 100 A 80 80 0 0 1 180 100" 
                  fill="none" 
                  stroke={gaugeColor} 
                  strokeWidth="16" 
                  strokeLinecap="round" 
                  strokeDasharray={gaugeDashArray} 
                  strokeDashoffset={gaugeDashOffset} 
                  style={{ transition: 'stroke-dashoffset 1s ease-out, stroke 0.5s ease-out' }} 
                />
             </svg>
             <div className="absolute bottom-2 flex flex-col items-center">
               <span className={`text-4xl font-mono tracking-tighter`} style={{ color: gaugeColor }}>
                 {currentScore.toFixed(1)}
               </span>
               <span className="text-[10px] text-zinc-500 font-medium tracking-widest uppercase mt-1">Out of 100</span>
             </div>
          </div>
        </div>
        <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-6 flex flex-col justify-center">
          <div className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"><TrendingDown className="w-3.5 h-3.5"/> High Anomalies</div>
          <div className="text-4xl font-mono text-zinc-100">{articles.filter(a => a.riskSeverity >= 8).length}</div>
          <div className="text-xs text-zinc-500 mt-2">Severe events trailing 24h</div>
        </div>
        <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-6 flex flex-col justify-center">
          <div className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"><BookOpen className="w-3.5 h-3.5"/> Processed Articles</div>
          <div className="text-4xl font-mono text-zinc-100">{articles.length}</div>
          <div className="text-xs text-zinc-500 mt-2">Sourced automatically</div>
        </div>
      </div>

      {/* Score Timeline */}
      <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-6 w-full">
        <h3 className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-6">Score Timeline (Last 7 Days)</h3>
        <div className="h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={scoreChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorRisk" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ffffff" stopOpacity={0.1}/>
                  <stop offset="95%" stopColor="#ffffff" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="time" stroke="#52525b" tick={{fill: '#71717a', fontSize: 11}} dy={10} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} stroke="#52525b" tick={{fill: '#71717a', fontSize: 11}} dx={-10} axisLine={false} tickLine={false} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', color: '#f4f4f5', borderRadius: '8px', fontSize: '12px' }}
                itemStyle={{ color: '#ffffff' }}
              />
              <Area type="monotone" dataKey="Risk" stroke="#ffffff" strokeWidth={1.5} fillOpacity={1} fill="url(#colorRisk)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Visual Summary Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>
          <h2 className="text-sm font-medium text-zinc-100 uppercase tracking-widest">Visual Summary</h2>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Volume Bar Chart */}
          <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-6 relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.01] to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
            <h3 className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-6">News Volume by Category</h3>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={volumeChartData} layout="vertical" margin={{ top: 0, right: 30, left: 30, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" stroke="#52525b" tick={{fill: '#71717a', fontSize: 11}} width={100} axisLine={false} tickLine={false} />
                  <Tooltip 
                    cursor={{fill: '#18181b', radius: 4}}
                    contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', color: '#f4f4f5', borderRadius: '8px', fontSize: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.5)' }}
                    itemStyle={{ color: '#ffffff', fontWeight: 500 }}
                  />
                  <Bar dataKey="count" fill="#3f3f46" radius={[4, 4, 4, 4]} barSize={8}>
                    {volumeChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={index === 0 ? '#e4e4e7' : '#3f3f46'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Sentiment Trend Line Chart */}
          <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-6 relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-bl from-white/[0.01] to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
            <h3 className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-6">Sentiment Trend by Asset</h3>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sentimentChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="time" stroke="#52525b" tick={{fill: '#71717a', fontSize: 11}} dy={10} axisLine={false} tickLine={false} />
                  <YAxis domain={[-1, 1]} stroke="#52525b" tick={{fill: '#71717a', fontSize: 11}} dx={-10} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', color: '#f4f4f5', borderRadius: '8px', fontSize: '12px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.5)' }}
                    itemStyle={{ fontSize: 12, fontWeight: 500 }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px', color: '#71717a' }} iconType="circle" iconSize={6} />
                  {Array.from(allAssetsInSentiment).map(asset => (
                    <Line 
                      key={asset}
                      type="monotone"
                      dataKey={asset}
                      stroke={ASSET_COLORS[asset] || '#ffffff'}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 7-Day Risk Heatmap */}
          <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-6 relative overflow-hidden group lg:col-span-2">
            <div className="absolute inset-0 bg-gradient-to-t from-white/[0.01] to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
            <h3 className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-6">7-Day Risk Heatmap</h3>
            <div className="w-full flex items-start gap-4 overflow-x-auto custom-scrollbar pb-2">
              <div className="flex flex-col gap-1.5 mt-6 pr-4 border-r border-zinc-800/50 shrink-0">
                {heatmapDays.map(day => (
                  <div key={`label-${day}`} className="h-6 text-[10px] text-zinc-500 font-medium flex items-center justify-end uppercase tracking-widest">
                    {day}
                  </div>
                ))}
              </div>
              <div className="flex-1 min-w-[700px] flex gap-1.5">
                 {heatmapHours.map(hour => (
                   <div key={`col-${hour}`} className="flex-1 flex flex-col gap-1.5">
                     <div className="text-[10px] text-zinc-600 text-center mb-1.5 font-mono">{hour.toString().padStart(2, '0')}</div>
                     {heatmapDays.map(day => {
                       const severity = heatmapData[`${day}-${hour}`];
                       return (
                         <div 
                           key={`cell-${day}-${hour}`}
                           className={`h-6 rounded-sm w-full transition-colors duration-300 ${
                             severity === 0 ? 'bg-zinc-800/30' :
                             severity < 4 ? 'bg-zinc-700 hover:bg-zinc-600' :
                             severity < 7 ? 'bg-zinc-400 hover:bg-zinc-300' :
                             'bg-zinc-100 hover:bg-white shadow-[0_0_8px_rgba(255,255,255,0.15)]'
                           }`}
                           title={`${day} ${hour}:00 - Max Risk: ${severity}`}
                         ></div>
                       );
                     })}
                   </div>
                 ))}
              </div>
            </div>
            {/* Heatmap Legend */}
            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-zinc-800/50">
              <span className="text-[10px] text-zinc-500 font-medium tracking-widest uppercase">Low Risk</span>
              <div className="flex gap-1.5">
                <div className="w-4 h-4 rounded-sm bg-zinc-800/30 border border-zinc-800/50"></div>
                <div className="w-4 h-4 rounded-sm bg-zinc-700"></div>
                <div className="w-4 h-4 rounded-sm bg-zinc-400"></div>
                <div className="w-4 h-4 rounded-sm bg-zinc-100 shadow-[0_0_8px_rgba(255,255,255,0.15)]"></div>
              </div>
              <span className="text-[10px] text-zinc-500 font-medium tracking-widest uppercase">High Risk</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Latest AI Report */}
        <div className="lg:col-span-1 bg-[#09090b] border border-zinc-800 rounded-xl p-6 flex flex-col">
          <h3 className="text-zinc-100 font-medium tracking-tight mb-6 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Daily AI Briefing
          </h3>
          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar text-sm text-zinc-400 font-sans leading-relaxed">
            {latestReport ? (
              <div className="markdown-body">
                <ReactMarkdown>{latestReport.content}</ReactMarkdown>
              </div>
            ) : (
               'Awaiting processing cycle...'
            )}
          </div>
          {latestReport && <div className="mt-6 pt-4 border-t border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-600">Generated: {new Date(latestReport.date).toLocaleString()}</div>}
        </div>

        {/* News Feed */}
        <div className="lg:col-span-2 bg-[#09090b] border border-zinc-800 rounded-xl overflow-hidden flex flex-col">
          <div className="p-6 border-b border-zinc-800">
            <h3 className="text-zinc-100 font-medium tracking-tight">Classified Intelligence Feed</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-400">
              <thead className="bg-[#09090b] border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4 font-semibold">Time</th>
                  <th className="px-6 py-4 font-semibold w-1/2">Headline</th>
                  <th className="px-6 py-4 font-semibold">Category</th>
                  <th className="px-6 py-4 font-semibold text-right">Sev.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {articles.slice(0, 8).map(article => (
                  <tr key={article.id} className="hover:bg-zinc-900/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap font-mono text-xs text-zinc-500">{format(new Date(article.timestamp), 'MMM dd HH:mm')}</td>
                    <td className="px-6 py-4 text-zinc-300">
                      <a href={article.url} target="_blank" rel="noreferrer" className="hover:text-white transition-colors line-clamp-1">{article.title}</a>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 text-[10px] uppercase tracking-wider rounded-md font-medium border ${article.riskType === 'No Risk' ? 'bg-zinc-800/30 text-zinc-400 border-zinc-700/50' : 'bg-red-500/5 text-red-400 border-red-500/20'}`}>
                        {article.riskType}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {article.riskSeverity > 0 ? (
                        <div className="flex items-center justify-end gap-3">
                           <span className="font-mono text-xs">{article.riskSeverity}</span>
                           <div className="w-10 h-1 bg-zinc-800 rounded-full overflow-hidden">
                              <div className={`h-full ${article.riskSeverity > 7 ? 'bg-red-400' : article.riskSeverity > 4 ? 'bg-amber-400' : 'bg-indigo-400'}`} style={{width: `${article.riskSeverity * 10}%`}}></div>
                           </div>
                        </div>
                      ) : '-'}
                    </td>
                  </tr>
                ))}
                {articles.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-zinc-600 border-none">Awaiting automated ingestion cycle...</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        
      </div>
    </div>
  );
}
