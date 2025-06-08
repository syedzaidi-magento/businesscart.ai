import os

def concatenate_files(base_directory, output_file, separator='='*80):
    with open(output_file, 'w', encoding='utf-8') as outfile:
        for root, dirs, files in os.walk(base_directory):
            for file in files:
                file_path = os.path.join(root, file)
                try:
                    with open(file_path, 'r', encoding='utf-8') as infile:
                        # Write separator with file path
                        outfile.write(f"\n{separator}\nFILE: {file_path}\n{separator}\n")
                        outfile.write(infile.read())
                except Exception as e:
                    print(f"Failed to read {file_path}: {e}")

if __name__ == "__main__":
    base_folder = "./web-portal/src"  # Replace with your folder path
    output_file_path = "./web-portal/combined_content.txt"
    concatenate_files(base_folder, output_file_path)
    print(f"All files concatenated into {output_file_path}")
