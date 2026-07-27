


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."get_all_category_article_counts"() RETURNS TABLE("category_id" "uuid", "article_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT combined.category_id, COUNT(DISTINCT combined.article_id) AS article_count
  FROM (
    SELECT category_id, id AS article_id FROM articles WHERE category_id IS NOT NULL
    UNION ALL
    SELECT ac.category_id, ac.article_id FROM article_categories ac
  ) combined
  GROUP BY combined.category_id;
$$;


ALTER FUNCTION "public"."get_all_category_article_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_category_article_count"("cat_id" "uuid") RETURNS bigint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT COUNT(DISTINCT article_id)
  FROM (
    SELECT id AS article_id FROM articles WHERE category_id = cat_id
    UNION
    SELECT article_id FROM article_categories WHERE category_id = cat_id
  ) combined;
$$;


ALTER FUNCTION "public"."get_category_article_count"("cat_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (NEW.id, NEW.email, 'user')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."article_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "article_id" "uuid" NOT NULL,
    "category_id" "uuid" NOT NULL,
    "assigned_by" "text" DEFAULT 'llm'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "article_categories_assigned_by_check" CHECK (("assigned_by" = ANY (ARRAY['llm'::"text", 'mapping'::"text", 'default'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."article_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."articles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_id" "uuid",
    "title" "text" NOT NULL,
    "url" "text" NOT NULL,
    "description" "text",
    "image_url" "text",
    "language" "text" DEFAULT 'und'::"text" NOT NULL,
    "published_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_category_raw" "text",
    "categorization_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "category_id" "uuid",
    CONSTRAINT "articles_categorization_status_check" CHECK (("categorization_status" = ANY (ARRAY['pending'::"text", 'done'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."articles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" DEFAULT 'user'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'user'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."retention_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_id" "uuid",
    "source_name" "text",
    "deleted_count" integer DEFAULT 0 NOT NULL,
    "run_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."retention_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."source_category_mappings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_id" "uuid" NOT NULL,
    "source_category_raw" "text" NOT NULL,
    "category_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."source_category_mappings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "url" "text" NOT NULL,
    "type" "text" NOT NULL,
    "language" "text" DEFAULT 'auto'::"text" NOT NULL,
    "interval_minutes" integer NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "selector_container" "text",
    "selector_title" "text",
    "selector_link" "text",
    "selector_description" "text",
    "selector_date" "text",
    "selector_category" "text",
    "slug" "text",
    "default_category_id" "uuid",
    "retention_days" integer,
    "last_scraped_at" timestamp with time zone,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "scraping_in_progress" boolean DEFAULT false NOT NULL,
    "selector_image" "text",
    CONSTRAINT "sources_interval_minutes_check" CHECK (("interval_minutes" >= 5)),
    CONSTRAINT "sources_retention_days_check" CHECK ((("retention_days" IS NULL) OR ("retention_days" > 0))),
    CONSTRAINT "sources_slug_check" CHECK ((("slug" ~ '^[a-z0-9-]+$'::"text") AND ("char_length"("slug") <= 80))),
    CONSTRAINT "sources_type_check" CHECK (("type" = ANY (ARRAY['rss'::"text", 'html'::"text"]))),
    CONSTRAINT "sources_url_check" CHECK (("char_length"("url") <= 2000))
);


ALTER TABLE "public"."sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_settings" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."system_settings" OWNER TO "postgres";


ALTER TABLE ONLY "public"."article_categories"
    ADD CONSTRAINT "article_categories_article_id_category_id_key" UNIQUE ("article_id", "category_id");



ALTER TABLE ONLY "public"."article_categories"
    ADD CONSTRAINT "article_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."articles"
    ADD CONSTRAINT "articles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."retention_log"
    ADD CONSTRAINT "retention_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."source_category_mappings"
    ADD CONSTRAINT "source_category_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."source_category_mappings"
    ADD CONSTRAINT "source_category_mappings_source_id_source_category_raw_key" UNIQUE ("source_id", "source_category_raw");



ALTER TABLE ONLY "public"."sources"
    ADD CONSTRAINT "sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sources"
    ADD CONSTRAINT "sources_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key");



CREATE INDEX "idx_article_categories_article_id" ON "public"."article_categories" USING "btree" ("article_id");



CREATE INDEX "idx_article_categories_category_id" ON "public"."article_categories" USING "btree" ("category_id");



CREATE INDEX "idx_articles_categorization_status" ON "public"."articles" USING "btree" ("categorization_status");



CREATE INDEX "idx_articles_created_at" ON "public"."articles" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_articles_language" ON "public"."articles" USING "btree" ("language");



CREATE INDEX "idx_articles_published_at" ON "public"."articles" USING "btree" ("published_at" DESC);



CREATE INDEX "idx_articles_source_id" ON "public"."articles" USING "btree" ("source_id");



CREATE INDEX "idx_articles_source_published" ON "public"."articles" USING "btree" ("source_id", "published_at" DESC);



CREATE INDEX "idx_articles_title_search" ON "public"."articles" USING "gin" ("to_tsvector"('"simple"'::"regconfig", "title"));



CREATE UNIQUE INDEX "idx_articles_url_unique" ON "public"."articles" USING "btree" ("lower"("url"));



CREATE UNIQUE INDEX "idx_categories_name_lower" ON "public"."categories" USING "btree" ("lower"("name"));



CREATE INDEX "idx_retention_log_run_at" ON "public"."retention_log" USING "btree" ("run_at" DESC);



CREATE INDEX "idx_retention_log_source_id" ON "public"."retention_log" USING "btree" ("source_id");



CREATE INDEX "idx_source_category_mappings_category_id" ON "public"."source_category_mappings" USING "btree" ("category_id");



CREATE INDEX "idx_source_category_mappings_source_id" ON "public"."source_category_mappings" USING "btree" ("source_id");



CREATE INDEX "idx_sources_is_active" ON "public"."sources" USING "btree" ("is_active");



CREATE INDEX "idx_sources_last_scraped_at" ON "public"."sources" USING "btree" ("last_scraped_at");



CREATE INDEX "idx_sources_slug" ON "public"."sources" USING "btree" ("slug");



CREATE INDEX "idx_sources_type" ON "public"."sources" USING "btree" ("type");



CREATE INDEX "profiles_role_idx" ON "public"."profiles" USING "btree" ("role");



CREATE OR REPLACE TRIGGER "articles_updated_at" BEFORE UPDATE ON "public"."articles" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "categories_updated_at" BEFORE UPDATE ON "public"."categories" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "set_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "sources_updated_at" BEFORE UPDATE ON "public"."sources" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."article_categories"
    ADD CONSTRAINT "article_categories_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."article_categories"
    ADD CONSTRAINT "article_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."articles"
    ADD CONSTRAINT "articles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."articles"
    ADD CONSTRAINT "articles_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."retention_log"
    ADD CONSTRAINT "retention_log_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."source_category_mappings"
    ADD CONSTRAINT "source_category_mappings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."source_category_mappings"
    ADD CONSTRAINT "source_category_mappings_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sources"
    ADD CONSTRAINT "sources_default_category_id_fkey" FOREIGN KEY ("default_category_id") REFERENCES "public"."categories"("id") ON DELETE SET NULL;



CREATE POLICY "Admins can delete article categories" ON "public"."article_categories" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete articles" ON "public"."articles" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete categories" ON "public"."categories" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete source category mappings" ON "public"."source_category_mappings" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete sources" ON "public"."sources" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert article categories" ON "public"."article_categories" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert categories" ON "public"."categories" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert source category mappings" ON "public"."source_category_mappings" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert sources" ON "public"."sources" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can read all profiles" ON "public"."profiles" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admins can update article categories" ON "public"."article_categories" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update categories" ON "public"."categories" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update sources" ON "public"."sources" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update system_settings" ON "public"."system_settings" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Authenticated users can read article categories" ON "public"."article_categories" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can read articles" ON "public"."articles" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can read categories" ON "public"."categories" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can read retention_log" ON "public"."retention_log" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can read source category mappings" ON "public"."source_category_mappings" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can read sources" ON "public"."sources" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can read system_settings" ON "public"."system_settings" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Service role can delete articles" ON "public"."articles" FOR DELETE TO "service_role" USING (true);



CREATE POLICY "Service role can insert article categories" ON "public"."article_categories" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "Service role can insert articles" ON "public"."articles" FOR INSERT WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can insert categories" ON "public"."categories" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "Service role can insert retention_log" ON "public"."retention_log" FOR INSERT TO "service_role" WITH CHECK (true);



CREATE POLICY "Service role can read system_settings" ON "public"."system_settings" FOR SELECT TO "service_role" USING (true);



CREATE POLICY "Service role can update articles" ON "public"."articles" FOR UPDATE USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can update categories" ON "public"."categories" FOR UPDATE TO "service_role" USING (true);



CREATE POLICY "Service role can update system_settings" ON "public"."system_settings" FOR UPDATE TO "service_role" USING (true);



CREATE POLICY "Service role full access" ON "public"."profiles" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Users can read own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK ((("auth"."uid"() = "id") AND ("role" = ( SELECT "profiles_1"."role"
   FROM "public"."profiles" "profiles_1"
  WHERE ("profiles_1"."id" = "auth"."uid"())))));



ALTER TABLE "public"."article_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."articles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."retention_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."source_category_mappings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_settings" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."get_all_category_article_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_all_category_article_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_all_category_article_counts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_category_article_count"("cat_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_category_article_count"("cat_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_category_article_count"("cat_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON TABLE "public"."article_categories" TO "anon";
GRANT ALL ON TABLE "public"."article_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."article_categories" TO "service_role";



GRANT ALL ON TABLE "public"."articles" TO "anon";
GRANT ALL ON TABLE "public"."articles" TO "authenticated";
GRANT ALL ON TABLE "public"."articles" TO "service_role";



GRANT ALL ON TABLE "public"."categories" TO "anon";
GRANT ALL ON TABLE "public"."categories" TO "authenticated";
GRANT ALL ON TABLE "public"."categories" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."retention_log" TO "anon";
GRANT ALL ON TABLE "public"."retention_log" TO "authenticated";
GRANT ALL ON TABLE "public"."retention_log" TO "service_role";



GRANT ALL ON TABLE "public"."source_category_mappings" TO "anon";
GRANT ALL ON TABLE "public"."source_category_mappings" TO "authenticated";
GRANT ALL ON TABLE "public"."source_category_mappings" TO "service_role";



GRANT ALL ON TABLE "public"."sources" TO "anon";
GRANT ALL ON TABLE "public"."sources" TO "authenticated";
GRANT ALL ON TABLE "public"."sources" TO "service_role";



GRANT ALL ON TABLE "public"."system_settings" TO "anon";
GRANT ALL ON TABLE "public"."system_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."system_settings" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";

-- ---------------------------------------------------------------------------
-- Trigger on auth.users.
--
-- `supabase db dump` only emits the public schema, so this trigger is absent
-- from the generated baseline above even though it exists on production. It
-- must be declared explicitly: without it a database rebuilt from this file
-- accepts registrations into auth.users but never creates the matching
-- public.profiles row, which breaks login and every RLS policy that reads
-- profiles.role.
--
-- The function is schema-qualified because this file runs with search_path=''
-- (see the set_config call at the top). CREATE OR REPLACE is used rather than
-- DROP + CREATE because the postgres role holds TRIGGER privilege on auth.users
-- but does not own it, and DROP TRIGGER requires ownership.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER "on_auth_user_created"
    AFTER INSERT ON "auth"."users"
    FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();







