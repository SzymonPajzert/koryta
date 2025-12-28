
import json
import csv
import collections
from pathlib import Path

def extract_rtdb_data(input_path, output_path):
    print(f"Loading {input_path}...")
    try:
        with open(input_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"Error: File not found at {input_path}")
        return

    rows = collections.defaultdict(lambda: {'text_content': [], 'score': set(), 'source_types': set()})

    def add_row(source_type, entity_name, entity_id, text_content, score=None, user_id=None, json_path=None, rejestr_io_id=None, comment_id=None):
        nonlocal rows
        if not text_content and score is None:
            return
        
        key = (entity_name, entity_id, rejestr_io_id)
        if not entity_name:
             key = (entity_name, entity_id, rejestr_io_id, user_id)
        
        rows[key]['source_types'].add(source_type)

        if text_content:
            rows[key]['text_content'].append(text_content)
        if score is not None:
            rows[key]['score'].add(score)

    # 1. Employed
    print("Processing 'employed'...")
    employed_nodes = data.get('employed', {})
    for emp_id, emp_data in employed_nodes.items():
        name = emp_data.get('name')
        
        # Comments
        comments = emp_data.get('comments', {})
        for cid, cdata in comments.items():
            text = cdata.get('text') if isinstance(cdata, dict) else str(cdata)
            add_row('employed_comment', name, emp_id, text, comment_id=cid, json_path=f"employed.{emp_id}.comments.{cid}")

        # Employments text
        employments = emp_data.get('employments', {})
        for eid, edata in employments.items():
            text = edata.get('text')
            if text:
                add_row('employed_employment', name, emp_id, text, json_path=f"employed.{emp_id}.employments.{eid}")
            
            # Connection text inside employment? (Ref: employed.<key>.employments.<key>.connection.text - 147 counts)
            conn = edata.get('connection', {})
            if isinstance(conn, dict) and conn.get('text'):
                 add_row('employed_employment_connection', name, emp_id, conn.get('text'), json_path=f"employed.{emp_id}.employments.{eid}.connection")


        # Connections text
        connections = emp_data.get('connections', {})
        for cid, cdata in connections.items():
            text = cdata.get('text')
            if text:
                 add_row('employed_connection', name, emp_id, text, json_path=f"employed.{emp_id}.connections.{cid}")

    # 2. Data (People/Companies/Comments)
    print("Processing 'data'...")
    data_nodes = data.get('data', {})
    for cur_id, cur_data in data_nodes.items():
        name = cur_data.get('name')

        # Comments
        comments = cur_data.get('comments', {})
        for cid, cdata in comments.items():
             text = cdata.get('text')
             add_row('data_comment', name, cur_id, text, comment_id=cid, json_path=f"data.{cur_id}.comments.{cid}")

        # People text
        people = cur_data.get('people', {})
        for pid, pdata in people.items():
            text = pdata.get('text')
            if text:
                 add_row('data_person', name, cur_id, text, json_path=f"data.{cur_id}.people.{pid}", rejestr_io_id=pid) # Pid might be rejestr_io_id? usually distinct.

        # Companies text
        companies = cur_data.get('companies', {})
        for cid, cdata in companies.items():
            text = cdata.get('text')
            if text:
                 add_row('data_company', name, cur_id, text, json_path=f"data.{cur_id}.companies.{cid}", rejestr_io_id=cid)

    # 3. Company
    print("Processing 'company'...")
    company_nodes = data.get('company', {})
    for com_id, com_data in company_nodes.items():
        # Name might not be directly here, usually 'name' is in data, but let's check or leave empty/ID.
        # Analysis showed company.<key>.comments
        name = com_data.get('name', f"Company {com_id}") 
        
        comments = com_data.get('comments', {})
        for cid, cdata in comments.items():
            text = cdata.get('text')
            add_row('company_comment', name, com_id, text, comment_id=cid, json_path=f"company.{com_id}.comments.{cid}")

        owners = com_data.get('owners', {})
        for oid, odata in owners.items():
            text = odata.get('text')
            if text:
                 add_row('company_owner', name, com_id, text, json_path=f"company.{com_id}.owners.{oid}")
        
        # Single owner/manager fields
        if com_data.get('owner', {}).get('text'):
             add_row('company_owner_single', name, com_id, com_data['owner']['text'], json_path=f"company.{com_id}.owner")
        if com_data.get('manager', {}).get('text'):
             add_row('company_manager_single', name, com_id, com_data['manager']['text'], json_path=f"company.{com_id}.manager")

    # 4. External (Rejestr-io Person Comments)
    print("Processing 'external'...")
    external = data.get('external', {})
    rejestr = external.get('rejestr-io', {})
    people_ext = rejestr.get('person', {})
    
    for pid, pdata in people_ext.items():
        rejestr_io_id = pid
        name = pdata.get('name')
        
        # Comments
        comments = pdata.get('comment', {})
        if isinstance(comments, dict):
            for cid, ctext in comments.items():
                text = ctext
                if isinstance(ctext, dict):
                    text = ctext.get('text', str(ctext))
                
                add_row('external_person_comment', name, None, text, rejestr_io_id=rejestr_io_id, comment_id=cid, json_path=f"external.rejestr-io.person.{pid}.comment.{cid}")
        
        # Score
        if 'score' in pdata:
             add_row('external_person_score', name, None, None, score=pdata['score'], rejestr_io_id=rejestr_io_id, json_path=f"external.rejestr-io.person.{pid}.score")


    # 5. User (Scores & Suggestions)
    print("Processing 'user'...")
    users = data.get('user', {})
    for uid, udata in users.items():
        # Validating it is a user dict
        if not isinstance(udata, dict): continue

        # Scores (KPO)
        kpo_scores = udata.get('kpo', {}).get('scores', {})
        for item_id, score_val in kpo_scores.items():
             add_row('user_kpo_score', None, item_id, None, score=score_val, user_id=uid, json_path=f"user.{uid}.kpo.scores.{item_id}")
        
        # Suggestions
        suggestions = udata.get('suggestions', {})
        
        # Iterate over categories in suggestions (employed, data, company etc.)
        for category, cat_data in suggestions.items():
            if isinstance(cat_data, dict):
                for item_id, item_val in cat_data.items():
                    text_repr = str(item_val)
                    if isinstance(item_val, dict):
                        # check for data/text fields inside
                        pass
                    
                    add_row(f'user_suggestion_{category}', None, item_id, text_repr, user_id=uid, json_path=f"user.{uid}.suggestions.{category}.{item_id}")


    # Process and Write to CSV
    final_rows = []
    print(f"Aggregating {len(rows)} grouped entities...")
    
    for key, values in rows.items():
        entity_name, entity_id, rejestr_io_id = key[:3]
        
        # Join source types
        source_type = "; ".join(sorted(values['source_types']))

        # Join text content
        # Filter None/Empty and duplicates if desired, but concatenation usually implies keeping all unique or all.
        # "join text_content column" -> I'll join with newlines.
        texts = [t for t in values['text_content'] if t]
        joined_text = "\n".join(texts)
        
        # Coalesce scores
        scores = values['score']
        final_score = None
        if len(scores) > 1:
            raise ValueError(f"Conflicting scores for {key}: {scores}")
        elif len(scores) == 1:
            final_score = list(scores)[0]
            
        final_rows.append({
            'source_type': source_type,
            'entity_name': entity_name,
            'entity_id': entity_id,
            'rejestr_io_id': rejestr_io_id,
            'text_content': joined_text,
            'score': final_score
        })
        
    print(f"Writing {len(final_rows)} aggregated rows to {output_path}...")
    fieldnames = ['source_type', 'entity_name', 'entity_id', 'rejestr_io_id', 'text_content', 'score']
    
    with open(output_path, 'w', newline='', encoding='utf-8') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(final_rows)

    print("Done.")

if __name__ == "__main__":
    base_path = Path(".")
    input_file = base_path / "downloaded/koryta-pl-default-rtdb-export.json"
    output_file = base_path / "downloaded/extracted_rtdb_data.csv"
    
    extract_rtdb_data(input_file, output_file)
