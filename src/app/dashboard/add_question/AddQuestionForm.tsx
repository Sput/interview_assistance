"use client";

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createClient } from '@/lib/supabase';
import { toast } from 'sonner';

export default function AddQuestionForm() {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [categories, setCategories] = useState<Array<{ id: string | number; name: string }>>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [question, setQuestion] = useState('');
  const [errors, setErrors] = useState<{ category?: string; question?: string }>(
    {}
  );
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    console.log('🚀 Form submission started');
    console.log('📝 Form data:', { selectedCategoryId, question });

    const nextErrors: { category?: string; question?: string } = {};
    if (!selectedCategoryId) nextErrors.category = 'Category is required';
    if (!question.trim()) nextErrors.question = 'New Question is required';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      console.log('❌ Validation failed:', nextErrors);
      toast.error('Please fill in all required fields.');
      return;
    }
    console.log('✅ Validation passed');

    setSubmitting(true);
    try {
      console.log('🔌 Creating Supabase client...');
      const supabase = createClient();

      console.log('💾 Inserting question into database...');
      const chosen = categories.find((c) => String(c.id) === String(selectedCategoryId));
      const categoryName = chosen?.name ?? null;
      const categoryId = selectedCategoryId ? Number(selectedCategoryId) : null;
      const { data: inserted, error } = await supabase
        .from('questions_table')
        .insert({
          interview_question: question.trim(),
          category: categoryName ?? undefined,
          category_id: categoryId ?? undefined,
        })
        .select('id')
        .single();

      if (error) {
        console.error('❌ Database insert error:', error);
        toast.error('Failed to save question.');
        console.error('Insert error:', error);
        return;
      }
      console.log('✅ Question inserted successfully:', inserted);
      // Best-effort: invoke edge functions
      const questionId = (inserted as any)?.id as number | undefined;
      console.log('🔍 Extracted question ID:', questionId);
      
      if (questionId) {
        console.log('📞 Triggering edge functions via API route for question ID:', questionId);
        
        try {
          const response = await fetch('/api/trigger-question-functions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question_id: questionId })
          });
          
          const result = await response.json();
          console.log('✅ Edge functions API response:', result);
          
          if (result.errors && result.errors.length > 0) {
            console.warn('⚠️ Some edge functions had errors:', result.errors);
            toast.error('Some background processes failed');
          } else {
            console.log('✅ All edge functions completed successfully');
          }
        } catch (apiErr) {
          console.error('❌ Failed to trigger edge functions via API:', apiErr);
          toast.error('Failed to trigger background processes');
        }
      } else {
        console.warn('⚠️ No question ID found, skipping edge function invocations');
      }


      console.log('🎉 Form submission completed successfully');
      toast.success('Question added successfully.');
      setSelectedCategoryId('');
      setQuestion('');
      setErrors({});
      console.log('🧹 Form cleared and reset');
    } catch (err) {
      console.error('❌ Unexpected error during form submission:', err);
      toast.error('An unexpected error occurred.');
    } finally {
      setSubmitting(false);
      console.log('🏁 Form submission ended, submitting state reset');
    }
  }

  // Fetch categories from DB
  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();
    async function load() {
      setLoadingCategories(true);
      const { data, error } = await supabase
        .from('question_categories')
        .select('id, category_name')
        .order('category_name', { ascending: true });
      if (!isMounted) return;
      if (error) {
        console.error('Failed to load categories', error);
        toast.error('Failed to load categories');
      } else {
        // Map to expected shape; tolerate different id types
        const mapped = (data || [])
          .map((row: any) => ({ id: row.id, name: row.category_name ?? '' }))
          .filter((r) => r.name);
        setCategories(mapped);
      }
      setLoadingCategories(false);
    }
    load();

    // Listen for external updates from the manager component
    function handleRefresh() {
      load();
    }
    window.addEventListener('question-categories-changed', handleRefresh);
    return () => {
      isMounted = false;
      window.removeEventListener('question-categories-changed', handleRefresh);
    };
  }, []);

  return (
    <form className='space-y-6' onSubmit={onSubmit}>
      <div className='grid gap-2'>
        <Label htmlFor='category'>Category</Label>
        <Select value={selectedCategoryId} onValueChange={(v) => setSelectedCategoryId(v)}>
          <SelectTrigger id='category' aria-invalid={Boolean(errors.category)}>
            <SelectValue placeholder={loadingCategories ? 'Loading…' : 'Select a category'} />
          </SelectTrigger>
          <SelectContent>
            {categories.length === 0 && !loadingCategories ? (
              <SelectItem value='__no_categories__' disabled>
                No categories found
              </SelectItem>
            ) : null}
            {categories.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.category ? (
          <p className='text-sm text-destructive'>{errors.category}</p>
        ) : null}
      </div>

      <div className='grid gap-2'>
        <Label htmlFor='new-question'>New Question</Label>
        <Textarea
          id='new-question'
          name='new_question'
          placeholder='Enter new question'
          className='min-h-24 resize-y'
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          aria-invalid={Boolean(errors.question)}
        />
        {errors.question ? (
          <p className='text-sm text-destructive'>{errors.question}</p>
        ) : null}
      </div>

      <div>
        <Button type='submit' disabled={submitting}>
          {submitting ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
