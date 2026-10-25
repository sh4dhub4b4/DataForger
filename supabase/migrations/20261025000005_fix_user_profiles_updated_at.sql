-- 20261025000005_fix_user_profiles_updated_at.sql
-- Add updated_at column to user_profiles and update safe_upsert_profile

ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.safe_upsert_profile(
    p_phone TEXT,
    p_username TEXT,
    p_bio TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_clean_phone TEXT;
    v_clean_username TEXT;
    v_clean_bio TEXT;
    v_points INT;
BEGIN
    v_clean_phone := regexp_replace(p_phone, '\s+', '', 'g');
    IF v_clean_phone !~ '^(\+8801|01)[3-9]\d{8}$' THEN
        RAISE EXCEPTION 'Invalid Bangladeshi mobile number';
    END IF;

    v_clean_username := regexp_replace(p_username, '[^a-zA-Z0-9_]', '', 'g');
    IF length(v_clean_username) < 3 OR length(v_clean_username) > 25 THEN
        RAISE EXCEPTION 'Username must be 3-25 alphanumeric characters';
    END IF;

    v_clean_bio := substring(trim(COALESCE(p_bio, 'PC Builder & Hardware Enthusiast')) from 1 for 140);

    SELECT COALESCE(reputation_points, 25) INTO v_points
    FROM public.user_profiles
    WHERE user_phone = v_clean_phone;

    IF v_points IS NULL THEN
        v_points := 25;
    END IF;

    INSERT INTO public.user_profiles (user_phone, username, bio, reputation_points, updated_at)
    VALUES (v_clean_phone, v_clean_username, v_clean_bio, v_points, now())
    ON CONFLICT (user_phone) DO UPDATE
    SET username = EXCLUDED.username,
        bio = EXCLUDED.bio,
        updated_at = now();

    RETURN jsonb_build_object(
        'user_phone', v_clean_phone,
        'username', v_clean_username,
        'bio', v_clean_bio,
        'reputation_points', v_points
    );
END;
$$;
