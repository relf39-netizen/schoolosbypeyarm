// Mock Supabase Client that proxies requests to our MySQL Express Backend
// This allows us to keep using the Supabase-style syntax in the frontend
// while actually storing data in MySQL.

const API_URL = ''; // Relative to the current host

class SupabaseQueryBuilder {
  private tableName: string;
  private filters: Record<string, any> = {};
  private orderCol?: string;
  private orderDir?: 'asc' | 'desc';
  private limitCount?: number;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  eq(column: string, value: any) {
    this.filters[column] = value;
    return this;
  }

  in(column: string, values: any[]) {
    this.filters[column] = `in.(${values.join(',')})`;
    return this;
  }

  order(column: string, { ascending = true } = {}) {
    this.orderCol = column;
    this.orderDir = ascending ? 'asc' : 'desc';
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  async then(onfulfilled?: (value: any) => any) {
    const queryParams = new URLSearchParams(this.filters);
    if (this.orderCol) queryParams.append('order', `${this.orderCol}.${this.orderDir}`);
    if (this.limitCount) queryParams.append('limit', this.limitCount.toString());

    try {
      const response = await fetch(`${API_URL}/api/table/${this.tableName}?${queryParams.toString()}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      const result = { data, error: null };
      return onfulfilled ? onfulfilled(result) : result;
    } catch (error: any) {
      const result = { data: null, error: { message: error.message } };
      return onfulfilled ? onfulfilled(result) : result;
    }
  }

  async insert(data: any) {
    try {
      const response = await fetch(`${API_URL}/api/table/${this.tableName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const result = await response.json();
      return { data: result, error: null };
    } catch (error: any) {
      return { data: null, error: { message: error.message } };
    }
  }

  async update(data: any) {
    // For update, we need to know which record to update. 
    // Our generic backend might need a more specific route or query params.
    // For now, let's assume we use the filters to identify the record.
    const queryParams = new URLSearchParams(this.filters);
    try {
      const response = await fetch(`${API_URL}/api/table/${this.tableName}?${queryParams.toString()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const result = await response.json();
      return { data: result, error: null };
    } catch (error: any) {
      return { data: null, error: { message: error.message } };
    }
  }

  async delete() {
    const queryParams = new URLSearchParams(this.filters);
    try {
      const response = await fetch(`${API_URL}/api/table/${this.tableName}?${queryParams.toString()}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const result = await response.json();
      return { data: result, error: null };
    } catch (error: any) {
      return { data: null, error: { message: error.message } };
    }
  }

  async upsert(data: any) {
    // In our backend, POST to /api/table handles upsert (INSERT ... ON DUPLICATE KEY UPDATE)
    return this.insert(data);
  }

  select(columns: string = '*') {
    // If this is called as a chained method after insert/update/delete, 
    // it just returns this for chaining.
    // If it's called on the builder itself, it's already handled by the constructor.
    return this;
  }

  // Add maybeSingle() support
  async maybeSingle() {
    const result = await this.then();
    if (result.data && Array.isArray(result.data)) {
      return { data: result.data[0] || null, error: result.error };
    }
    return result;
  }

  // Add single() support
  async single() {
    const result = await this.then();
    if (result.data && Array.isArray(result.data)) {
      if (result.data.length === 0) {
        return { data: null, error: { message: 'JSON object requested, but no rows returned' } };
      }
      return { data: result.data[0], error: result.error };
    }
    return result;
  }
}

export const supabase = {
  from: (tableName: string) => new SupabaseQueryBuilder(tableName),
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
    signInWithPassword: async () => ({ data: { user: null }, error: new Error('Use custom login') }),
    signOut: async () => ({ error: null }),
  }
};

export const isConfigured = true; // Always true because we use our own backend

// SQL Schema for reference (MySQL compatible)
export const DATABASE_SQL = `
-- 1. ตารางโรงเรียน
CREATE TABLE IF NOT EXISTS schools (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  district VARCHAR(255),
  province VARCHAR(255),
  lat FLOAT,
  lng FLOAT,
  radius INT DEFAULT 500,
  late_time_threshold VARCHAR(255) DEFAULT '08:30',
  logo_base_64 LONGTEXT,
  is_suspended BOOLEAN DEFAULT FALSE
);

-- 2. ตารางโปรไฟล์ผู้ใช้งาน
CREATE TABLE IF NOT EXISTS profiles (
  id VARCHAR(255) PRIMARY KEY,
  school_id VARCHAR(255),
  name VARCHAR(255) NOT NULL,
  password VARCHAR(255) DEFAULT '123456',
  position VARCHAR(255),
  roles JSON,
  signature_base_64 LONGTEXT,
  telegram_chat_id VARCHAR(255),
  is_suspended BOOLEAN DEFAULT FALSE,
  is_approved BOOLEAN DEFAULT FALSE,
  assigned_classes JSON
);
`;

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
  is_alumni BOOLEAN DEFAULT FALSE,
  graduation_year TEXT,
  batch_number TEXT,
  phone_number TEXT,
  father_name TEXT,
  mother_name TEXT,
  guardian_name TEXT,
  medical_conditions TEXT,
  photo_url TEXT,
  address TEXT,
  lat FLOAT,
  lng FLOAT,
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
`;
