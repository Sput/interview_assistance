import PageContainer from '@/components/layout/page-container';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import AddQuestionForm from './AddQuestionForm';
import QuestionCategoriesManager from './QuestionCategoriesManager';

export const metadata = {
  title: 'Dashboard: Add Question'
};

export default function Page() {
  return (
    <PageContainer>
      <div className='mx-auto w-full max-w-2xl space-y-6'>
        <div className='text-center'>
          <p className='text-lg text-muted-foreground'>
            Enter a new question and select a category to add it to the database. When you create a new question, an edge function will generate a model response that users need to match.
            That answer will then be converted to a vector and stored in the database.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className='text-2xl font-bold'>Add Question</CardTitle>
          </CardHeader>
          <CardContent>
            <AddQuestionForm />
          </CardContent>
        </Card>
        <div className='text-center'>
          <p className='text-lg text-muted-foreground'>
            Manage the categories of questions that can be added to the database.
          </p>
        </div>
        <QuestionCategoriesManager />
      </div>
    </PageContainer>
  );
}
