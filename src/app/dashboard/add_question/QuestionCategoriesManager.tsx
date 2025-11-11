"use client";

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

type Category = { id: string | number; name: string };

export default function QuestionCategoriesManager() {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [editingName, setEditingName] = useState('');

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('question_categories')
      .select('id, category_name')
      .order('category_name', { ascending: true });
    if (error) {
      console.error('Failed to load categories', error);
      toast.error('Failed to load categories');
    } else {
      const mapped = (data || [])
        .map((row: any) => ({ id: row.id, name: row.category_name ?? '' }))
        .filter((r) => r.name);
      setCategories(mapped);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function notifyChanged() {
    window.dispatchEvent(new CustomEvent('question-categories-changed'));
  }

  async function addCategory() {
    const name = newName.trim();
    if (!name) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from('question_categories')
      .insert({ category_name: name })
      .select('id, category_name')
      .single();
    setSaving(false);
    if (error) {
      console.error('Failed to add category', error);
      toast.error('Failed to add category');
      return;
    }
    toast.success('Category added');
    setNewName('');
    setCategories((prev) => [...prev, { id: (data as any).id, name: (data as any).category_name ?? name }].sort((a, b) => a.name.localeCompare(b.name)));
    notifyChanged();
  }

  function startEdit(cat: Category) {
    setEditingId(cat.id);
    setEditingName(cat.name);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingName('');
  }

  async function saveEdit() {
    if (editingId == null) return;
    const name = editingName.trim();
    if (!name) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('question_categories')
      .update({ category_name: name })
      .eq('id', editingId);
    setSaving(false);
    if (error) {
      console.error('Failed to update category', error);
      toast.error('Failed to update category');
      return;
    }
    toast.success('Category updated');
    setCategories((prev) => prev.map((c) => (c.id === editingId ? { ...c, name } : c)).sort((a, b) => a.name.localeCompare(b.name)));
    setEditingId(null);
    setEditingName('');
    notifyChanged();
  }

  async function remove(cat: Category) {
    const ok = confirm(`Delete category "${cat.name}"?`);
    if (!ok) return;
    setSaving(true);
    const { error } = await supabase
      .from('question_categories')
      .delete()
      .eq('id', cat.id);
    setSaving(false);
    if (error) {
      console.error('Failed to delete category', error);
      toast.error('Failed to delete category');
      return;
    }
    toast.success('Category deleted');
    setCategories((prev) => prev.filter((c) => c.id !== cat.id));
    notifyChanged();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-xl font-semibold'>Manage Categories</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='grid gap-2'>
          <Label htmlFor='new-category'>Add New Category</Label>
          <div className='flex gap-2'>
            <Input
              id='new-category'
              placeholder='e.g., Algorithms'
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button onClick={addCategory} disabled={saving}>
              {saving ? 'Saving…' : 'Add'}
            </Button>
          </div>
        </div>

        <div className='space-y-2'>
          <div className='text-sm text-muted-foreground'>Existing Categories</div>
          {loading ? (
            <div className='text-sm text-muted-foreground'>Loading…</div>
          ) : categories.length === 0 ? (
            <div className='text-sm text-muted-foreground'>No categories yet</div>
          ) : (
            <ul className='divide-y rounded-md border'>
              {categories.map((cat) => (
                <li key={cat.id} className='flex items-center gap-2 p-2'>
                  {editingId === cat.id ? (
                    <>
                      <Input
                        aria-label='Category name'
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                      />
                      <Button size='sm' onClick={saveEdit} disabled={saving}>
                        Save
                      </Button>
                      <Button size='sm' variant='secondary' onClick={cancelEdit} disabled={saving}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className='flex-1'>{cat.name}</div>
                      <Button size='sm' variant='outline' onClick={() => startEdit(cat)}>
                        Edit
                      </Button>
                      <Button size='sm' variant='destructive' onClick={() => remove(cat)} disabled={saving}>
                        Delete
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
