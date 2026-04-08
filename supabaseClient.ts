// Supabase client replaced with Express API proxy

// Mock Supabase client that uses our Express API
const API_BASE = '/api';

export const isConfigured = true;

export const supabase = {
  from: (tableName: string) => {
    const queryParams = new URLSearchParams();
    
    const builder: any = {
      select: (columns: string = '*') => {
        // In this mock, we don't really filter columns, but we return the builder for chaining
        return builder;
      },
      eq: (column: string, value: any) => {
        queryParams.append(column, value);
        return builder;
      },
      order: (column: string, { ascending = true } = {}) => {
        queryParams.append('order', `${column}.${ascending ? 'asc' : 'desc'}`);
        return builder;
      },
      limit: (count: number) => {
        queryParams.append('limit', count.toString());
        return builder;
      },
      // This makes the builder "awaitable"
      then: async (onfulfilled: any) => {
        try {
          const method = builder.method || 'GET';
          const url = `${API_BASE}/table/${tableName}${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
          
          const options: any = { method };
          if (builder.body) {
            options.headers = { 'Content-Type': 'application/json' };
            options.body = JSON.stringify(builder.body);
          }

          const res = await fetch(url, options);
          const data = await res.json();
          const result = (data && data.error) ? { data: null, error: data.error } : { data, error: null };
          return onfulfilled ? onfulfilled(result) : result;
        } catch (error) {
          const result = { data: null, error };
          return onfulfilled ? onfulfilled(result) : result;
        }
      },
      single: async () => {
        const { data, error } = await builder;
        return { data: (data && data.length > 0) ? data[0] : null, error };
      },
      maybeSingle: async () => {
        const { data, error } = await builder;
        return { data: (data && data.length > 0) ? data[0] : null, error };
      },
      insert: async (data: any) => {
        try {
          const res = await fetch(`${API_BASE}/table/${tableName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });
          const result = await res.json();
          return (result && result.error) ? { data: null, error: result.error } : { data: result, error: null };
        } catch (error) {
          return { data: null, error };
        }
      },
      upsert: async (data: any) => {
        try {
          const res = await fetch(`${API_BASE}/table/${tableName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });
          const result = await res.json();
          return (result && result.error) ? { data: null, error: result.error } : { data: result, error: null };
        } catch (error) {
          return { data: null, error };
        }
      },
      update: (data: any) => {
        builder.method = 'PATCH';
        builder.body = data;
        return builder;
      },
      delete: () => {
        builder.method = 'DELETE';
        return builder;
      }
    };
    
    return builder;
  },
  channel: () => ({
    on: () => ({
      subscribe: () => ({ unsubscribe: () => {} })
    }),
    subscribe: () => ({ unsubscribe: () => {} })
  }),
  removeChannel: () => {}
} as any;

export const DATABASE_SQL = `
-- 1. ตารางโรงเรียน
CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  district TEXT,
  province TEXT,
  lat FLOAT,
  lng FLOAT,
  radius INT DEFAULT 500,
  late_time_threshold TEXT DEFAULT '08:30',
  logo_base_64 TEXT,
  is_suspended BOOLEAN DEFAULT FALSE
);

-- 2. ตารางโปรไฟล์ผู้ใช้งาน
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  password TEXT DEFAULT '123456',
  position TEXT,
  roles TEXT[],
  signature_base_64 TEXT,
  telegram_chat_id TEXT,
  is_suspended BOOLEAN DEFAULT FALSE,
  is_approved BOOLEAN DEFAULT FALSE,
  assigned_classes TEXT[] DEFAULT '{}'
);

-- 3. ตารางการตั้งค่าโรงเรียน (API Keys / Config)
CREATE TABLE IF NOT EXISTS school_configs (
  school_id TEXT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  drive_folder_id TEXT,
  script_url TEXT,
  telegram_bot_token TEXT,
  telegram_bot_username TEXT,
  app_base_url TEXT,
  official_garuda_base_64 TEXT,
  officer_department TEXT,
  internal_departments TEXT[],
  external_agencies TEXT[],
  director_signature_base_64 TEXT,
  director_signature_scale FLOAT DEFAULT 1.0,
  director_signature_y_offset FLOAT DEFAULT 0
);

-- 3.1 ตารางห้องเรียน
CREATE TABLE IF NOT EXISTS class_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. ตารางงานวิชาการ: จำนวนนักเรียน
CREATE TABLE IF NOT EXISTS academic_enrollments (
  id TEXT PRIMARY KEY, -- enroll_{schoolId}_{year}
  school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
  year TEXT NOT NULL,
  levels JSONB NOT NULL -- เก็บ { "Anuban1": { "m": 0, "f": 0 }, ... }
);

-- 5. ตารางงานวิชาการ: คะแนนสอบเฉลี่ย (RT, NT, O-NET)
CREATE TABLE IF NOT EXISTS academic_test_scores (
  id TEXT PRIMARY KEY, -- score_{schoolId}_{type}_{year}
  school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
  year TEXT NOT NULL,
  test_type TEXT NOT NULL, -- RT, NT, ONET_P6, ONET_M3
  results JSONB NOT NULL -- เก็บ { "Math": 50.5, ... }
);

-- 6. ตารางงานวิชาการ: ปฏิทินวิชาการ
CREATE TABLE IF NOT EXISTS academic_calendar (
  id BIGSERIAL PRIMARY KEY,
  school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
  year TEXT NOT NULL,
  title TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  description TEXT
);

-- 7. ตารางงานวิชาการ: รายงาน SAR
CREATE TABLE IF NOT EXISTS academic_sar (
  id BIGSERIAL PRIMARY KEY,
  school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
  year TEXT NOT NULL,
  type TEXT NOT NULL, -- BASIC, EARLY_CHILDHOOD
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL
);

-- 8. ตารางงบประมาณรายปี (Action Plan)
CREATE TABLE IF NOT EXISTS budget_settings (
  id TEXT PRIMARY KEY,
  school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
  fiscal_year TEXT,
  subsidy FLOAT DEFAULT 0,
  learner FLOAT DEFAULT 0,
  allow_teacher_proposal BOOLEAN DEFAULT FALSE
);

-- 9. ตารางโครงการในแผนปฏิบัติการ
CREATE TABLE IF NOT EXISTS plan_projects (
  id TEXT PRIMARY KEY,
  school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
  department_name TEXT NOT NULL,
  name TEXT NOT NULL,
  subsidy_budget FLOAT DEFAULT 0,
  learner_dev_budget FLOAT DEFAULT 0,
  actual_expense FLOAT DEFAULT 0,
  status TEXT DEFAULT 'Draft',
  fiscal_year TEXT
);

-- 10. ตารางนักเรียน
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  current_class TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. ตารางการออมทรัพย์นักเรียน
CREATE TABLE IF NOT EXISTS student_savings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
  amount FLOAT NOT NULL,
  type TEXT NOT NULL, -- DEPOSIT, WITHDRAWAL
  academic_year TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  edited_at TIMESTAMP WITH TIME ZONE,
  edited_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  edit_reason TEXT
);

-- 12. ตารางปีการศึกษา
CREATE TABLE IF NOT EXISTS academic_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
  year TEXT NOT NULL,
  is_current BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 13. ตารางปฏิทินปฏิบัติงาน ผอ.
CREATE TABLE IF NOT EXISTS director_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  location TEXT,
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  notified_one_day_before BOOLEAN DEFAULT FALSE,
  notified_on_day BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- เพิ่มคอลัมน์สำหรับการลงเวลากลับอัตโนมัติ
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schools' AND column_name='auto_check_out_enabled') THEN
        ALTER TABLE schools ADD COLUMN auto_check_out_enabled BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schools' AND column_name='auto_check_out_time') THEN
        ALTER TABLE schools ADD COLUMN auto_check_out_time TEXT DEFAULT '16:30';
    END IF;
    
    -- สำหรับตาราง attendance (ถ้ามี)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='attendance') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='attendance' AND column_name='leave_type') THEN
            ALTER TABLE attendance ADD COLUMN leave_type TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='attendance' AND column_name='is_auto_checkout') THEN
            ALTER TABLE attendance ADD COLUMN is_auto_checkout BOOLEAN DEFAULT FALSE;
        END IF;
    END IF;
END $$;
`;
