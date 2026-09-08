import customtkinter as ctk
import tkinter as tk
from tkinter import messagebox
from backend import ScraperBackend, CodeGenerator, ScriptRunner
import threading
import json

# --- APPEARANCE SETUP ---
ctk.set_appearance_mode("Dark")
ctk.set_default_color_theme("blue")

class ScraperGUI(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("PyScrape Builder v1.0")
        self.geometry("1100x700")
        
        # Initialize Backend
        self.backend = ScraperBackend()
        self.runner = ScriptRunner()
        self.current_project = None
        
        # Container for all frames
        self.container = ctk.CTkFrame(self)
        self.container.pack(fill="both", expand=True, padx=10, pady=10)
        
        self.frames = {}
        self.show_dashboard()

    def show_dashboard(self):
        self.clear_container()
        DashboardFrame(self.container, self).pack(fill="both", expand=True)

    def show_project_view(self, project_name):
        self.current_project = project_name
        self.clear_container()
        ProjectViewFrame(self.container, self, project_name).pack(fill="both", expand=True)

    def show_config_editor(self, project_name, config_name=None):
        self.clear_container()
        ConfigEditorFrame(self.container, self, project_name, config_name).pack(fill="both", expand=True)

    def clear_container(self):
        for widget in self.container.winfo_children():
            widget.destroy()

# =======================================================
# 1️⃣ STATE 1: DASHBOARD (Project Manager)
# =======================================================
class DashboardFrame(ctk.CTkFrame):
    def __init__(self, parent, controller):
        super().__init__(parent)
        self.controller = controller
        
        # Header
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(fill="x", pady=(0, 20))
        ctk.CTkLabel(header, text="Project Dashboard", font=("Arial", 24, "bold")).pack(side="left")
        ctk.CTkButton(header, text="+ New Directory", command=self.create_project_popup, fg_color="green").pack(side="right")

        # Project List
        self.scroll_frame = ctk.CTkScrollableFrame(self, label_text="Your Workspaces")
        self.scroll_frame.pack(fill="both", expand=True)
        
        self.refresh_list()

    def refresh_list(self):
        for widget in self.scroll_frame.winfo_children():
            widget.destroy()
            
        projects = self.controller.backend.get_all_projects()
        
        if not projects:
            ctk.CTkLabel(self.scroll_frame, text="No projects found. Create one to start.").pack(pady=20)
            return

        for proj in projects:
            row = ctk.CTkFrame(self.scroll_frame)
            row.pack(fill="x", pady=5, padx=5)
            
            # Icon & Name
            ctk.CTkLabel(row, text=f"📂 {proj}", font=("Arial", 16)).pack(side="left", padx=10)
            
            # Buttons
            ctk.CTkButton(row, text="Open", width=80, command=lambda p=proj: self.controller.show_project_view(p)).pack(side="right", padx=5)
            ctk.CTkButton(row, text="Delete", width=80, fg_color="red", command=lambda p=proj: self.delete_project(p)).pack(side="right", padx=5)

    def create_project_popup(self):
        dialog = ctk.CTkInputDialog(text="Enter Directory Name:", title="New Project")
        name = dialog.get_input()
        if name:
            success, msg = self.controller.backend.create_project(name)
            if success:
                self.refresh_list()
            else:
                tk.messagebox.showerror("Error", msg)

    def delete_project(self, name):
        if tk.messagebox.askyesno("Confirm", f"Are you sure you want to delete '{name}' and all its scrapers?"):
            self.controller.backend.delete_project(name)
            self.refresh_list()

# =======================================================
# 2️⃣ STATE 2: PROJECT VIEW (Website List)
# =======================================================
class ProjectViewFrame(ctk.CTkFrame):
    def __init__(self, parent, controller, project_name):
        super().__init__(parent)
        self.controller = controller
        self.project_name = project_name
        
        # Header
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(fill="x", pady=(0, 20))
        ctk.CTkButton(header, text="← Back", width=60, command=controller.show_dashboard).pack(side="left", padx=(0, 10))
        ctk.CTkLabel(header, text=f"Directory: {project_name}", font=("Arial", 20, "bold")).pack(side="left")
        
        # Actions
        actions = ctk.CTkFrame(self, fg_color="transparent")
        actions.pack(fill="x", pady=(0, 10))
        ctk.CTkButton(actions, text="+ Add Website Config", command=lambda: controller.show_config_editor(project_name)).pack(side="left", padx=5)
        ctk.CTkButton(actions, text="Import JSON", command=self.import_config).pack(side="left", padx=5)
        ctk.CTkButton(actions, text="▶ Run All", fg_color="orange", command=self.run_batch).pack(side="right")

        # Config List
        self.scroll_frame = ctk.CTkScrollableFrame(self, label_text="Configured Websites")
        self.scroll_frame.pack(fill="both", expand=True)
        
        self.refresh_list()

    def refresh_list(self):
        for widget in self.scroll_frame.winfo_children():
            widget.destroy()
            
        configs = self.controller.backend.get_configs_in_project(self.project_name)
        
        for conf in configs:
            row = ctk.CTkFrame(self.scroll_frame)
            row.pack(fill="x", pady=5, padx=5)
            
            lbl = ctk.CTkLabel(row, text=f"🌐 {conf}", font=("Monospace", 14))
            lbl.pack(side="left", padx=10)
            
            # Action Buttons
            ctk.CTkButton(row, text="Edit / Debug", width=100, 
                          command=lambda c=conf: self.controller.show_config_editor(self.project_name, c)).pack(side="right", padx=5)
            
            ctk.CTkButton(row, text="Run Solo", width=80, fg_color="green", 
                           command=lambda c=conf: self.run_solo(c)).pack(side="right", padx=5)

    def import_config(self):
        file_path = tk.filedialog.askopenfilename(filetypes=[("JSON Files", "*.json")])
        if file_path:
            success, msg = self.controller.backend.import_config(file_path, self.project_name)
            if success:
                self.refresh_list()
            else:
                tk.messagebox.showerror("Error", msg)

    def run_solo(self, config_file):
        # Determine paths
        import os
        project_path = os.path.join(self.controller.backend.root_dir, self.project_name)
        
        # Load config to generate code
        data = self.controller.backend.load_config(self.project_name, config_file)
        
        # Check for Manual Override
        if data.get('manual_override', {}).get('enabled'):
            code = data['manual_override']['raw_code']
            print("Using Manual Code Override")
        else:
            code = CodeGenerator.generate_script(data)
            print("Using Generated Code")

        # Open a mini log window
        LogWindow(self, code, project_path)

    def run_batch(self):
        tk.messagebox.showinfo("Feature", "Batch processing logic would loop through all JSONs here.")

# =======================================================
# 3️⃣ STATE 3: CONFIG EDITOR (The Builder)
# =======================================================
class ConfigEditorFrame(ctk.CTkFrame):
    def __init__(self, parent, controller, project_name, config_filename=None):
        super().__init__(parent)
        self.controller = controller
        self.project_name = project_name
        self.config_filename = config_filename
        self.backend = controller.backend
        
        # Load Existing or Template
        if config_filename:
            self.data = self.backend.load_config(project_name, config_filename)
        else:
            self.data = self.backend.get_empty_template()

        # Header
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(fill="x", pady=(0, 10))
        ctk.CTkButton(header, text="← Cancel", width=60, fg_color="gray", command=lambda: controller.show_project_view(project_name)).pack(side="left")
        ctk.CTkLabel(header, text="Scraper Configuration", font=("Arial", 18, "bold")).pack(side="left", padx=20)
        ctk.CTkButton(header, text="💾 Save Config", fg_color="green", command=self.save_config).pack(side="right")

        # Tabs - With Auto Update Command
        self.tabview = ctk.CTkTabview(self, command=self.on_tab_switch)
        self.tabview.pack(fill="both", expand=True)
        
        self.tab_setup = self.tabview.add("1. General")
        self.tab_fields = self.tabview.add("2. Fields")
        self.tab_pag = self.tabview.add("3. Pagination") # New Tab
        self.tab_output = self.tabview.add("4. Output")
        self.tab_code = self.tabview.add("5. Code & Debug")
        
        self.build_setup_tab()
        self.build_fields_tab()
        self.build_pagination_tab() # Build it
        self.build_output_tab()
        self.build_code_tab()

    def on_tab_switch(self):
        """Auto-refreshes code when the user clicks the Code tab."""
        if self.tabview.get() == "5. Code & Debug":
            if not self.var_manual.get():
                self.generate_code_preview()

    # --- TAB 1: SETUP ---
    def build_setup_tab(self):
        f = self.tab_setup
        
        ctk.CTkLabel(f, text="Configuration Name (File Name):").pack(anchor="w")
        self.entry_name = ctk.CTkEntry(f, placeholder_text="e.g. techland_monitor")
        self.entry_name.pack(fill="x", pady=(0, 10))
        self.entry_name.insert(0, self.data['meta']['name'])

        ctk.CTkLabel(f, text="Target URL:").pack(anchor="w")
        self.entry_url = ctk.CTkEntry(f, placeholder_text="https://...")
        self.entry_url.pack(fill="x", pady=(0, 10))
        self.entry_url.insert(0, self.data['meta']['url'])
        
        # Checkboxes
        self.var_headless = ctk.BooleanVar(value=self.data['settings']['headless'])
        ctk.CTkCheckBox(f, text="Headless Mode (Hide Browser)", variable=self.var_headless).pack(anchor="w", pady=5)
        
        self.var_keep_open = ctk.BooleanVar(value=self.data['settings']['keep_open'])
        ctk.CTkCheckBox(f, text="Keep Browser Open (Debug)", variable=self.var_keep_open).pack(anchor="w", pady=5)

        # Container
        ctk.CTkLabel(f, text="Product Container Selector (Parent):").pack(anchor="w", pady=(10,0))
        self.entry_container = ctk.CTkEntry(f, placeholder_text="e.g. article.product-item")
        self.entry_container.pack(fill="x")
        self.entry_container.insert(0, self.data['container']['selector'])

    # --- TAB 2: FIELDS ---
    def build_fields_tab(self):
        f = self.tab_fields
        ctk.CTkButton(f, text="+ Add New Field", command=self.add_field_row).pack(pady=5)
        
        self.fields_frame = ctk.CTkScrollableFrame(f)
        self.fields_frame.pack(fill="both", expand=True)
        
        self.field_widgets = []
        
        # Load existing fields
        for field in self.data['fields']:
            self.add_field_row(field)

    def add_field_row(self, data=None):
        if data is None: data = {"name": "", "selector": "", "type": "css", "attr": "text"}
        
        row = ctk.CTkFrame(self.fields_frame)
        row.pack(fill="x", pady=2)
        
        e_name = ctk.CTkEntry(row, width=100, placeholder_text="Name")
        e_name.insert(0, data['name'])
        e_name.pack(side="left", padx=2)
        
        e_sel = ctk.CTkEntry(row, width=200, placeholder_text="Selector")
        e_sel.insert(0, data['selector'])
        e_sel.pack(side="left", padx=2, fill="x", expand=True)
        
        # Attribute Dropdown
        e_attr = ctk.CTkOptionMenu(row, values=["text", "href", "src", "innerHTML"], width=80)
        e_attr.set(data['attr'])
        e_attr.pack(side="left", padx=2)
        
        # Delete Button
        btn_del = ctk.CTkButton(row, text="X", width=30, fg_color="red", command=lambda: self.remove_field(row))
        btn_del.pack(side="right", padx=2)
        
        self.field_widgets.append((row, e_name, e_sel, e_attr))

    def remove_field(self, row_widget):
        row_widget.destroy()

    # --- TAB 3: PAGINATION ---
    def build_pagination_tab(self):
        f = self.tab_pag
        
        # Pagination Type
        ctk.CTkLabel(f, text="Pagination Strategy:").pack(anchor="w")
        self.opt_pag_type = ctk.CTkOptionMenu(f, values=["next_button", "none"])
        self.opt_pag_type.set(self.data['pagination']['type'])
        self.opt_pag_type.pack(anchor="w", pady=(0, 10))

        # Selector Input
        ctk.CTkLabel(f, text="Next Button Selector (XPath is best):").pack(anchor="w")
        self.entry_pag_sel = ctk.CTkEntry(f, placeholder_text="e.g. //a[contains(text(), 'Next')]")
        self.entry_pag_sel.pack(fill="x", pady=(0, 5))
        self.entry_pag_sel.insert(0, self.data['pagination']['selector'])
        
        ctk.CTkLabel(f, text="* Tip: Right click 'Next' button > Inspect > Copy XPath", 
                     text_color="gray", font=("Arial", 10)).pack(anchor="w", pady=(0, 15))

        # Limit
        ctk.CTkLabel(f, text="Max Pages Safety Limit:").pack(anchor="w")
        self.entry_pag_limit = ctk.CTkEntry(f)
        self.entry_pag_limit.pack(fill="x")
        self.entry_pag_limit.insert(0, str(self.data['pagination']['limit']))

    # --- TAB 4: OUTPUT ---
    def build_output_tab(self):
        f = self.tab_output
        ctk.CTkLabel(f, text="Output Filename (without extension):").pack(anchor="w")
        self.entry_outfile = ctk.CTkEntry(f)
        self.entry_outfile.pack(fill="x")
        self.entry_outfile.insert(0, self.data['output']['filename'])
        
        ctk.CTkLabel(f, text="Format:").pack(anchor="w", pady=(10,0))
        self.opt_format = ctk.CTkOptionMenu(f, values=["csv", "json"])
        self.opt_format.set(self.data['output']['format'])
        self.opt_format.pack(anchor="w")

        ctk.CTkLabel(f, text="CSV Delimiter:").pack(anchor="w", pady=(10,0))
        self.opt_delim = ctk.CTkOptionMenu(f, values=["|", ",", ";", "\t"])
        self.opt_delim.set(self.data['output']['delimiter'])
        self.opt_delim.pack(anchor="w")

    # --- TAB 5: CODE & DEBUG ---
    def build_code_tab(self):
        f = self.tab_code
        
        toolbar = ctk.CTkFrame(f)
        toolbar.pack(fill="x", pady=5)
        
        self.var_manual = ctk.BooleanVar(value=self.data['manual_override']['enabled'])
        self.chk_manual = ctk.CTkSwitch(toolbar, text="Enable Manual Edit (Unlock Code)", 
                                        variable=self.var_manual, command=self.toggle_manual_mode)
        self.chk_manual.pack(side="left")
        
        ctk.CTkButton(toolbar, text="🔄 Regenerate Code", command=self.generate_code_preview).pack(side="left", padx=20)
        ctk.CTkButton(toolbar, text="▶ RUN / DEBUG", fg_color="orange", command=self.run_debug).pack(side="right")

        self.txt_code = ctk.CTkTextbox(f, font=("Consolas", 12))
        self.txt_code.pack(fill="both", expand=True)
        
        # Load initial code
        if self.var_manual.get():
            self.txt_code.insert("0.0", self.data['manual_override']['raw_code'])
        else:
            self.generate_code_preview()
            self.toggle_manual_mode() # lock it if manual is off

    def toggle_manual_mode(self):
        if self.var_manual.get():
            self.txt_code.configure(state="normal")
        else:
            self.txt_code.configure(state="disabled")

    def gather_data(self):
        """Collects all data from GUI widgets into a dictionary."""
        # 1. Setup
        self.data['meta']['name'] = self.entry_name.get()
        self.data['meta']['url'] = self.entry_url.get()
        self.data['settings']['headless'] = self.var_headless.get()
        self.data['settings']['keep_open'] = self.var_keep_open.get()
        self.data['container']['selector'] = self.entry_container.get()
        
        # 2. Fields
        new_fields = []
        for row, name, sel, attr in self.field_widgets:
            if row.winfo_exists(): # Check if not deleted
                if name.get() and sel.get():
                    new_fields.append({
                        "name": name.get(),
                        "selector": sel.get(),
                        "type": "css", # Simplified for demo
                        "attr": attr.get()
                    })
        self.data['fields'] = new_fields

        # 3. Pagination (NEW BLOCK)
        self.data['pagination']['type'] = self.opt_pag_type.get()
        self.data['pagination']['selector'] = self.entry_pag_sel.get()
        limit = self.entry_pag_limit.get()
        self.data['pagination']['limit'] = int(limit) if limit.isdigit() else 100
        
        # 4. Output
        self.data['output']['filename'] = self.entry_outfile.get()
        self.data['output']['format'] = self.opt_format.get()
        self.data['output']['delimiter'] = self.opt_delim.get()
        
        # 5. Manual Code
        self.data['manual_override']['enabled'] = self.var_manual.get()
        self.data['manual_override']['raw_code'] = self.txt_code.get("0.0", "end")
        
        return self.data

    def generate_code_preview(self):
        if self.var_manual.get():
            if not tk.messagebox.askyesno("Warning", "Regenerating will overwrite your manual edits. Continue?"):
                return
        
        data = self.gather_data()
        code = CodeGenerator.generate_script(data)
        
        self.txt_code.configure(state="normal")
        self.txt_code.delete("0.0", "end")
        self.txt_code.insert("0.0", code)
        
        if not self.var_manual.get():
            self.txt_code.configure(state="disabled")

    def save_config(self):
        data = self.gather_data()
        if not data['meta']['name']:
            tk.messagebox.showerror("Error", "Configuration Name is required.")
            return

        success, msg = self.controller.backend.save_config(self.project_name, data)
        if success:
            tk.messagebox.showinfo("Saved", msg)
            self.controller.show_project_view(self.project_name)
        else:
            tk.messagebox.showerror("Error", msg)

    def run_debug(self):
        import os
        code = self.txt_code.get("0.0", "end")
        project_path = os.path.join(self.controller.backend.root_dir, self.project_name)
        
        # Open Log Window
        LogWindow(self, code, project_path)

# =======================================================
# 4️⃣ LOG WINDOW (The Execution Console)
# =======================================================
class LogWindow(ctk.CTkToplevel):
    def __init__(self, parent, code_string, working_dir):
        super().__init__(parent)
        self.title("Scraper Execution Console")
        self.geometry("800x600")
        
        self.runner = ScriptRunner()
        
        self.log_box = ctk.CTkTextbox(self, font=("Consolas", 10))
        self.log_box.pack(fill="both", expand=True, padx=10, pady=10)
        
        btn_stop = ctk.CTkButton(self, text="STOP EXECUTION", fg_color="red", command=self.runner.stop_code)
        btn_stop.pack(pady=10)
        
        self.protocol("WM_DELETE_WINDOW", self.on_close)
        
        # Start Running
        self.runner.run_code(code_string, working_dir, self.append_log)

    def append_log(self, text):
        self.log_box.insert("end", text + "\n")
        self.log_box.see("end")

    def on_close(self):
        self.runner.stop_code()
        self.destroy()

if __name__ == "__main__":
    app = ScraperGUI()
    app.mainloop()