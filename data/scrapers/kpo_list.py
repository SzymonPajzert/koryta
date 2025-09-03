from db import DBModel
print("before import")

from indenter import Nester
print("after import")

from dataclasses import dataclass
from time import sleep

nest = Nester(indent_string="  ", buffer=False)

@dataclass(eq=True, frozen=True)
class Company:
    commune: str
    name: str
    id: str
    id_type: str

if __name__ == "__main__":
    # TODO import caching of the data, so I don't read it each time
    detailed = DBModel("/external/kpo_detailed")
    current = detailed.get()
    print("after")
    assert isinstance(current, dict)
    
    companies = dict[Company, int]()
    
    for id, data in current.items():
        if "error_id" in data:
            print(id)
    
    for id, data in current.items():

        print(f"Zapytanie ofertowe numer {id}")
        for order in nest(data["data"]["advertisement"]["orders"]):
            print(order["title"])
            for item in nest(order["order_items"]):
                print(item["description"][:500].replace("\\r\\n", ""))
                company_raw = item["created_by"]["economic_subject"]
                company = Company(
                    commune=company_raw["address"].get("commune", ""),
                    name=company_raw["name"],
                    id=company_raw["identification_number"],
                    id_type=company_raw["identification_number_type"])
                companies[company] = companies.get(company, 0) + 1
            
        print("I'll write this: ")
        dump = nest.dump()
        print(dump)
        sleep(30)
        
    print("Done")
    print("Stats: ")
    print("\n".join(sorted(companies.items(), key=lambda x: x[1], reverse=True)))
    
    
        

