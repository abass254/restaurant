<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('instagram_accounts', function (Blueprint $table): void {
            $table->string('platform', 32)->default('instagram')->after('id')->index();
        });
    }

    public function down(): void
    {
        Schema::table('instagram_accounts', function (Blueprint $table): void {
            $table->dropIndex(['platform']);
            $table->dropColumn('platform');
        });
    }
};
