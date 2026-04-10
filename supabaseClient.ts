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

-- 3. ตารางการตั้งค่าโรงเรียน (API Keys / Config)
CREATE TABLE IF NOT EXISTS school_configs (
  school_id VARCHAR(255) PRIMARY KEY,
  drive_folder_id VARCHAR(255),
  script_url TEXT,
  telegram_bot_token VARCHAR(255),
  telegram_bot_username VARCHAR(255),
  app_base_url TEXT,
  official_garuda_base_64 LONGTEXT,
  officer_department VARCHAR(255),
  internal_departments JSON,
  external_agencies JSON,
  director_signature_base_64 LONGTEXT,
  director_signature_scale FLOAT DEFAULT 1.0,
  director_signature_y_offset FLOAT DEFAULT 0
);

-- 3.1 ตารางห้องเรียน
CREATE TABLE IF NOT EXISTS class_rooms (
  id VARCHAR(255) PRIMARY KEY,
  school_id VARCHAR(255),
  name VARCHAR(255) NOT NULL,
  academic_year VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. ตารางงานวิชาการ: จำนวนนักเรียน
CREATE TABLE IF NOT EXISTS academic_enrollments (
  id VARCHAR(255) PRIMARY KEY,
  school_id VARCHAR(255),
  year VARCHAR(255) NOT NULL,
  levels JSON NOT NULL
);

-- 5. ตารางงานวิชาการ: คะแนนสอบเฉลี่ย (RT, NT, O-NET)
CREATE TABLE IF NOT EXISTS academic_test_scores (
  id VARCHAR(255) PRIMARY KEY,
  school_id VARCHAR(255),
  year VARCHAR(255) NOT NULL,
  test_type VARCHAR(255) NOT NULL,
  results JSON NOT NULL
);

-- 6. ตารางงานวิชาการ: ปฏิทินวิชาการ
CREATE TABLE IF NOT EXISTS academic_calendar (
  id INT AUTO_INCREMENT PRIMARY KEY,
  school_id VARCHAR(255),
  year VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  description TEXT
);

-- 7. ตารางงานวิชาการ: รายงาน SAR
CREATE TABLE IF NOT EXISTS academic_sar (
  id INT AUTO_INCREMENT PRIMARY KEY,
  school_id VARCHAR(255),
  year VARCHAR(255) NOT NULL,
  type VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL
);

-- 8. ตารางงบประมาณรายปี (Action Plan)
CREATE TABLE IF NOT EXISTS budget_settings (
  id VARCHAR(255) PRIMARY KEY,
  school_id VARCHAR(255),
  fiscal_year VARCHAR(255),
  subsidy FLOAT DEFAULT 0,
  learner FLOAT DEFAULT 0,
  allow_teacher_proposal BOOLEAN DEFAULT FALSE
);

-- 9. ตารางโครงการในแผนปฏิบัติการ
CREATE TABLE IF NOT EXISTS plan_projects (
  id VARCHAR(255) PRIMARY KEY,
  school_id VARCHAR(255),
  department_name VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  subsidy_budget FLOAT DEFAULT 0,
  learner_dev_budget FLOAT DEFAULT 0,
  actual_expense FLOAT DEFAULT 0,
  status VARCHAR(255) DEFAULT 'Draft',
  fiscal_year VARCHAR(255)
);

-- 10. ตารางนักเรียน
CREATE TABLE IF NOT EXISTS students (
  id VARCHAR(255) PRIMARY KEY,
  school_id VARCHAR(255),
  name VARCHAR(255) NOT NULL,
  current_class VARCHAR(255) NOT NULL,
  academic_year VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  is_alumni BOOLEAN DEFAULT FALSE,
  graduation_year VARCHAR(255),
  batch_number VARCHAR(255),
  phone_number VARCHAR(255),
  father_name VARCHAR(255),
  mother_name VARCHAR(255),
  guardian_name VARCHAR(255),
  medical_conditions TEXT,
  photo_url TEXT,
  address TEXT,
  lat FLOAT,
  lng FLOAT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 11. ตารางการออมทรัพย์นักเรียน
CREATE TABLE IF NOT EXISTS student_savings (
  id VARCHAR(255) PRIMARY KEY,
  student_id VARCHAR(255),
  school_id VARCHAR(255),
  amount FLOAT NOT NULL,
  type VARCHAR(255) NOT NULL,
  academic_year VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(255),
  edited_at TIMESTAMP NULL,
  edited_by VARCHAR(255),
  edit_reason TEXT
);

-- 12. ตารางปีการศึกษา
CREATE TABLE IF NOT EXISTS academic_years (
  id VARCHAR(255) PRIMARY KEY,
  school_id VARCHAR(255),
  year VARCHAR(255) NOT NULL,
  is_current BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 13. ตารางปฏิทินปฏิบัติงาน ผอ.
CREATE TABLE IF NOT EXISTS director_events (
  id VARCHAR(255) PRIMARY KEY,
  school_id VARCHAR(255),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  start_time VARCHAR(255) NOT NULL,
  end_time VARCHAR(255),
  location VARCHAR(255),
  created_by VARCHAR(255),
  notified_one_day_before BOOLEAN DEFAULT FALSE,
  notified_on_day BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;
