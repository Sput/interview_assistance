-- ==========================================
-- Schema for Interview Assistance Database
-- ==========================================

-- Drop tables if they already exist (for clean setup)
DROP TABLE IF EXISTS answers_table;
DROP TABLE IF EXISTS questions_table;

-- ========================
-- Questions Table
-- ========================
CREATE TABLE questions_table (
    id SERIAL PRIMARY KEY,
    interview_question TEXT NOT NULL,
    model_answer TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========================
-- Answers Table
-- ========================
CREATE TABLE answers_table (
    id SERIAL PRIMARY KEY,
    question_id INT NOT NULL REFERENCES questions_table(id) ON DELETE CASCADE,
    answer_text TEXT,
    grade INT,
    user_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes (optional but good for performance)
CREATE INDEX idx_answers_question_id ON answers_table(question_id);
CREATE INDEX idx_answers_user_id ON answers_table(user_id);