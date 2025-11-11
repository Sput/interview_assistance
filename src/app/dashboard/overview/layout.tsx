'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase';
import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartConfig } from '@/components/ui/chart';

type AnswerRow = { grade: number | null; created_at: string };

export default function OverViewLayout() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [grades, setGrades] = useState<AnswerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      const supabase = createClient();
      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (!user) {
        setUserEmail(null);
        setGrades([]);
        setLoading(false);
        return;
      }

      setUserEmail(user.email ?? user.user_metadata?.email ?? user.id);
      console.log('[overview] current user id:', user.id);

      const query = supabase
        .from('answers_table')
        .select('grade')
        .eq('user_id', user.id)
        .limit(200);

      const { data: rows, error } = await query;

      if (error) {
        console.error('[overview] Failed to load grades:', error);
        setGrades([]);
      } else {
        const dataRows = ((rows as any[]) || []).map((r) => ({
          grade: r.grade as number | null,
          created_at: r.created_at as string,
        })) as AnswerRow[];
        const gradedCount = dataRows.filter((r) => r.grade !== null).length;
        console.log(
          `[overview] fetched answers for ${user.id}: total=${dataRows.length}, graded=${gradedCount}`
        );
        if (dataRows.length === 0) {
          console.warn('[overview] Query returned zero rows. Check RLS policies and that answers_table.user_id matches the auth user.');
        }
        setGrades(dataRows);
      }
      setLoading(false);
    };
    run();
  }, []);

  const isNewUser = useMemo(() => !userEmail, [userEmail]);
  const hasHistory = useMemo(() => grades.length > 0, [grades]);
  const graded = useMemo(() => grades.filter((g) => g.grade !== null), [grades]);
  const hasGraded = useMemo(() => graded.length > 0, [graded]);
  const avgGrade = useMemo(() => {
    if (!graded.length) return null;
    const vals = graded.map((g) => (g.grade ?? 0));
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }, [graded]);

  const chartData = useMemo(() => {
    return graded.map((g, idx) => ({
      idx: idx + 1,
      grade: g.grade ?? 0,
      date: g.created_at
    }));
  }, [graded]);

  const chartConfig = useMemo<ChartConfig>(() => ({
    grade: { label: 'Grade' }
  }), []);

  return (
    <PageContainer>
      <div className='flex flex-col gap-6'>
        <div className='flex items-end justify-between'>
          <div>
            <h1 className='text-2xl font-bold'>Welcome{userEmail ? `, ${userEmail}` : ''}</h1>
            {!hasHistory && !loading && (
              <p className='text-sm text-muted-foreground mt-1'>
                {isNewUser
                  ? 'Welcome! Sign in to start practicing interview questions and track your progress.'
                  : 'No past performance yet — answer your first question to see your progress here.'}
              </p>
            )}
            {hasHistory && !hasGraded && (
              <p className='text-sm text-muted-foreground mt-1'>
                You have answers on record. Grading is pending — results will appear here shortly.
              </p>
            )}
            {hasGraded && (
              <p className='text-sm text-muted-foreground mt-1'>
                Here’s a snapshot of your past performance.
              </p>
            )}
          </div>
          {hasGraded && avgGrade !== null && (
            <Badge variant='outline' title='Average grade'>Avg: {avgGrade}</Badge>
          )}
        </div>

        {loading ? (
          <Card>
            <CardHeader>
              <CardTitle>Loading your dashboard…</CardTitle>
              <CardDescription>Fetching your latest results</CardDescription>
            </CardHeader>
          </Card>
        ) : hasGraded ? (
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            <Card>
              <CardHeader>
                <CardTitle>Recent Performance</CardTitle>
                <CardDescription>Last {chartData.length} graded answers</CardDescription>
              </CardHeader>
              <CardContent className='px-2 pt-4 sm:px-6 sm:pt-6'>
                <ChartContainer config={chartConfig} className='h-[260px] w-full'>
                  <BarChart data={chartData} margin={{ left: 12, right: 12 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey='idx'
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickFormatter={(v) => `#${v}`}
                    />
                    <ChartTooltip
                      cursor={{ fill: 'var(--primary)', opacity: 0.08 }}
                      content={
                        <ChartTooltipContent
                          className='w-[160px]'
                          nameKey='grade'
                          labelFormatter={(value, payload) => {
                            const i = Number(value) - 1;
                            const d = chartData[i]?.date;
                            try {
                              return d ? new Date(d).toLocaleString() : `Answer ${value}`;
                            } catch {
                              return `Answer ${value}`;
                            }
                          }}
                        />
                      }
                    />
                    <Bar dataKey='grade' fill='var(--primary)' radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Overview</CardTitle>
                <CardDescription>Quick stats from your history</CardDescription>
              </CardHeader>
              <CardContent>
                <div className='grid grid-cols-2 gap-4'>
                  <div className='rounded-lg border p-4'>
                    <div className='text-xs text-muted-foreground'>Total answers</div>
                    <div className='text-2xl font-semibold'>{grades.length}</div>
                  </div>
                  <div className='rounded-lg border p-4'>
                    <div className='text-xs text-muted-foreground'>Average grade</div>
                    <div className='text-2xl font-semibold'>{avgGrade}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Welcome</CardTitle>
              <CardDescription>
                {isNewUser
                  ? 'Get started by logging in and trying your first interview question.'
                  : 'No graded answers yet. Start a practice session or check back after grading completes.'}
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
