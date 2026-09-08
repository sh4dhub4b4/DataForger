import os
import json
import shutil
import subprocess
import sys
import threading
from datetime import datetime

# ==========================================
# 1. FILE & DIRECTORY MANAGER
# ==========================================
class ScraperBackend:
    def __init__(self, root_dir="Scraper_Projects"):
        self.root_dir = root_dir
        if not os.path.exists(self.root_dir):
            os.makedirs(self.root_dir)

    def get_all_projects(self):
        return [d for d in os.listdir(self.root_dir) if os.path.isdir(os.path.join(self.root_dir, d))]

    def create_project(self, project_name):
        path = os.path.join(self.root_dir, project_name)
        outputs_path = os.path.join(path, "outputs")
        if not os.path.exists(path):
            os.makedirs(path)
            os.makedirs(outputs_path)
            return True, f"Project '{project_name}' created."
        return False, "Project already exists."

    def delete_project(self, project_name):
        path = os.path.join(self.root_dir, project_name)
        if os.path.exists(path):
            shutil.rmtree(path)
            return True, f"Project '{project_name}' deleted."
        return False, "Project not found."

    def get_configs_in_project(self, project_name):
        path = os.path.join(self.root_dir, project_name)
        if not os.path.exists(path): return []
        return [f for f in os.listdir(path) if f.endswith('.json')]

    def save_config(self, project_name, config_data):
        if not config_data['meta']['name']: return False, "Config name is empty"
        safe_name = "".join([c for c in config_data['meta']['name'] if c.isalnum() or c in (' ', '_')]).strip()
        filename = f"{safe_name.replace(' ', '_')}.json"
        path = os.path.join(self.root_dir, project_name, filename)
        try:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(config_data, f, indent=4)
            return True, f"Saved to {filename}"
        except Exception as e: return False, str(e)

    def load_config(self, project_name, filename):
        path = os.path.join(self.root_dir, project_name, filename)
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f: return json.load(f)
        return None

    def import_config(self, source_path, target_project):
        if not source_path.endswith('.json'): return False, "Invalid file type."
        target_dir = os.path.join(self.root_dir, target_project)
        if not os.path.exists(target_dir): return False, "Target directory missing."
        try:
            shutil.copy(source_path, target_dir)
            return True, "Import successful."
        except Exception as e: return False, f"Import failed: {e}"

    def get_empty_template(self):
        return {
            "meta": {"name": "", "url": "", "created_at": str(datetime.now())},
            "settings": {"browser": "Chrome", "headless": False, "keep_open": False, "load_delay": 3, "page_delay": 2},
            "container": {"selector": "", "type": "css"},
            "fields": [],
            "pagination": {"type": "next_button", "selector": "", "limit": 10},
            "output": {"filename": "data", "format": "csv", "delimiter": "|"},
            "manual_override": {"enabled": False, "raw_code": ""}
        }

# ==========================================
# 2. CODE GENERATOR (SMART DETECT UPGRADE)
# ==========================================
class CodeGenerator:
    @staticmethod
    def generate_script(config):
        meta = config.get('meta', {})
        settings = config.get('settings', {})
        container = config.get('container', {})
        fields = config.get('fields', [])
        pagination = config.get('pagination', {})
        output = config.get('output', {})

        def safe(val): return str(val).replace('"', '\\"')

        script = f'''# Generated Scraper
import time, csv, json, os
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
from selenium.common.exceptions import NoSuchElementException, TimeoutException

TARGET_URL = "{safe(meta.get('url', ''))}"
HEADLESS = {settings.get('headless', False)}
PAGE_DELAY = {settings.get('page_delay', 2)}
OUTPUT_FILE = "{safe(output.get('filename', 'data'))}.{output.get('format', 'csv')}"

def setup_driver():
    options = webdriver.ChromeOptions()
    if HEADLESS: options.add_argument("--headless")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    driver.maximize_window()
    return driver

def scrape():
    driver = setup_driver()
    all_data = []
    page_count = 1
    max_pages = {pagination.get('limit', 100)}
    
    try:
        print(f"Starting scrape on: {{TARGET_URL}}")
        driver.get(TARGET_URL)
        wait = WebDriverWait(driver, 15)
        time.sleep({settings.get('load_delay', 3)})

        while page_count <= max_pages:
            print(f"--- Scraping Page {{page_count}} ---")
            
            # 1. CONTAINER
            c_sel = "{safe(container.get('selector', ''))}"
            c_type = By.XPATH if "{container.get('type')}" == "xpath" else By.CSS_SELECTOR
            
            try:
                wait.until(EC.presence_of_all_elements_located((c_type, c_sel)))
                products = driver.find_elements(c_type, c_sel)
                print(f"Found {{len(products)}} items.")
            except TimeoutException:
                print("No items found.")
                break

            # 2. FIELDS
            for item in products:
                row = {{}}
                try:
'''
        for field in fields:
            f_name = safe(field.get('name', 'Unknown'))
            f_sel = safe(field.get('selector', ''))
            f_type = 'XPATH' if field.get('type') == 'xpath' else 'CSS_SELECTOR'
            f_attr = field.get('attr', 'text')
            
            script += f'''                    try:
                        el = item.find_element(By.{f_type}, "{f_sel}")
                        if "{f_attr}" == "text": row["{f_name}"] = el.text.strip()
                        elif "{f_attr}" == "href": row["{f_name}"] = el.get_attribute("href")
                        elif "{f_attr}" == "src": row["{f_name}"] = el.get_attribute("src")
                        else: row["{f_name}"] = el.get_attribute("{f_attr}")
                    except: row["{f_name}"] = "N/A"
'''
        
        script += '''                    all_data.append(row)
                except: continue

            # 3. PAGINATION (SMART DETECT)
'''
        if pagination.get('type') == 'next_button':
            p_sel = safe(pagination.get('selector', ''))
            # If it starts with "//" or "(", assume XPath. Otherwise CSS.
            p_type = "By.XPATH" if p_sel.startswith("//") or p_sel.startswith("(") else "By.CSS_SELECTOR"
            
            script += f'''            try:
                next_btn = driver.find_element({p_type}, "{p_sel}")
                if not next_btn.is_enabled(): break
                driver.execute_script("arguments[0].click();", next_btn)
                time.sleep(PAGE_DELAY)
                page_count += 1
            except: 
                print("Next button not found. Finishing.")
                break
'''
        else:
            script += '''            break'''

        script += f'''
    except Exception as e: print(f"Error: {{e}}")
    finally:
        driver.quit()
        if all_data:
            keys = all_data[0].keys()
            with open(OUTPUT_FILE, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=keys, delimiter="{safe(output.get('delimiter', '|'))}")
                writer.writeheader()
                writer.writerows(all_data)
            print(f"Saved {{len(all_data)}} rows.")

if __name__ == "__main__": scrape()
'''
        return script

# ==========================================
# 3. SCRIPT RUNNER
# ==========================================
class ScriptRunner:
    def __init__(self): self.process = None

    def run_code(self, code_string, working_dir, log_callback=None):
        abs_working_dir = os.path.abspath(working_dir)
        script_filename = "temp_debug_run.py"
        abs_script_path = os.path.join(abs_working_dir, script_filename)
        
        try:
            with open(abs_script_path, "w", encoding="utf-8") as f: f.write(code_string)
        except: return
            
        def target():
            try:
                self.process = subprocess.Popen([sys.executable, script_filename], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=abs_working_dir, bufsize=1)
                for line in self.process.stdout: 
                    if log_callback: log_callback(line.strip())
            except Exception as e: 
                if log_callback: log_callback(f"Error: {e}")
            finally:
                if log_callback: log_callback("--- Finished ---")
                if os.path.exists(abs_script_path): os.remove(abs_script_path)

        threading.Thread(target=target).start()

    def stop_code(self):
        if self.process: self.process.terminate()